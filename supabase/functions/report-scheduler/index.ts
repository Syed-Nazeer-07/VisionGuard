import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4'
import jsPDF from 'https://esm.sh/jspdf@2.5.1'
import autoTable from 'https://esm.sh/jspdf-autotable@3.6.0'

const resendApiKey = Deno.env.get('RESEND_API_KEY') || 're_mock_key_only_for_demo'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    // 1. Fetch scheduled reports that are due
    const { data: dueReports, error: fetchError } = await supabaseClient
      .from('scheduled_reports')
      .select('*')
      .lte('next_run_at', new Date().toISOString())
      .eq('status', 'Active')

    if (fetchError) throw fetchError

    if (!dueReports || dueReports.length === 0) {
      return new Response(JSON.stringify({ message: 'No scheduled reports due.' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const results = []

    for (const report of dueReports) {
      // Create execution record
      const { data: execution, error: execError } = await supabaseClient
        .from('report_executions')
        .insert({
          scheduled_report_id: report.id,
          started_at: new Date().toISOString(),
          status: 'running'
        })
        .select()
        .single()
        
      if (execError || !execution) continue;

      const startTime = Date.now()
      let retryCount = 0
      let success = false
      let finalError = ''

      while (retryCount < 3 && !success) {
        try {
          // A. Data Generation
          const { type, format, filters, recipients } = report
          const dateRange = (filters as any)?.dateRange || 'Last 7 Days'
          
          let startDate = new Date()
          if (dateRange === 'Today') startDate.setHours(0,0,0,0)
          else if (dateRange === 'Last 7 Days') startDate.setDate(startDate.getDate() - 7)
          else if (dateRange === 'Last 30 Days') startDate.setDate(startDate.getDate() - 30)
          else startDate.setDate(startDate.getDate() - 90)

          let records: any[] = []
          let headers: string[] = []
          let tableData: string[][] = []

          if (type === 'Traffic' || type === 'Incidents') {
            const { data } = await supabaseClient
              .from('incidents')
              .select('id, incident_type, severity, status, created_at, cameras(name)')
              .gte('created_at', startDate.toISOString())
              .order('created_at', { ascending: false })
              .limit(500)
            records = data || []
            headers = ['Incident ID', 'Type', 'Severity', 'Status', 'Camera', 'Timestamp']
            tableData = records.map(r => [
              `#${r.id.slice(0, 8)}`, r.incident_type || 'General', r.severity || 'Medium',
              r.status || 'Active', r.cameras?.name || 'Unassigned', new Date(r.created_at).toLocaleString()
            ])
          } else if (type === 'Enforcement') {
            const { data } = await supabaseClient
              .from('cases')
              .select('id, status, created_at, incident:incidents(incident_type, severity, cameras(name))')
              .gte('created_at', startDate.toISOString())
              .order('created_at', { ascending: false })
              .limit(500)
            records = data || []
            headers = ['Case ID', 'Status', 'Violation Type', 'Severity', 'Camera', 'Created At']
            tableData = records.map(r => [
              `#${r.id.slice(0, 8)}`, r.status, (r.incident as any)?.incident_type || 'Traffic Case',
              (r.incident as any)?.severity || 'Medium', (r.incident as any)?.cameras?.name || 'Street Camera',
              new Date(r.created_at).toLocaleString()
            ])
          } else {
            const { data } = await supabaseClient
              .from('audit_logs')
              .select('id, action, resource, timestamp, profile:profiles(name)')
              .gte('timestamp', startDate.toISOString())
              .order('timestamp', { ascending: false })
              .limit(500)
            records = data || []
            headers = ['Log ID', 'User', 'Action', 'Resource', 'Timestamp']
            tableData = records.map(r => [
              `#${r.id.slice(0, 8)}`, (r.profile as any)?.name || 'System', r.action,
              r.resource || 'System Setting', new Date(r.timestamp).toLocaleString()
            ])
          }

          let fileBlob: Blob
          const timestampStr = new Date().toISOString().replace(/[:.]/g, '-')
          const fileName = `${type}_Report_${timestampStr}.${format.toLowerCase()}`

          if (format === 'CSV') {
            const csvRows = [
              headers.join(','),
              ...tableData.map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))
            ]
            fileBlob = new Blob([csvRows.join('\n')], { type: 'text/csv' })
          } else {
            const doc = new jsPDF()
            doc.setFontSize(20)
            doc.text(`${type} Report`, 14, 22)
            doc.setFontSize(12)
            doc.text(`Generated: ${new Date().toLocaleString()}`, 14, 32)
            
            autoTable(doc, {
              startY: 40,
              head: [headers],
              body: tableData,
              theme: 'grid',
            })
            fileBlob = new Blob([doc.output('blob')], { type: 'application/pdf' })
          }

          // B. Upload to Storage
          const now = new Date()
          const year = now.getFullYear()
          const month = String(now.getMonth() + 1).padStart(2, '0')
          const storagePath = `reports/${year}/${month}/${report.id}/${fileName}`

          const { data: uploadData, error: uploadError } = await supabaseClient.storage
            .from('reports') 
            .upload(storagePath, fileBlob, { upsert: true, contentType: fileBlob.type })

          if (uploadError) throw new Error(`Storage error: ${uploadError.message}`)

          const { data: publicUrlData } = supabaseClient.storage.from('reports').getPublicUrl(storagePath)
          const fileUrl = publicUrlData.publicUrl

          // Save report row
          const { data: insertedReport, error: reportInsertError } = await supabaseClient
            .from('reports')
            .insert({
              name: fileName,
              type: type,
              format: format,
              file_url: fileUrl,
              file_path: storagePath,
              file_size: fileBlob.size,
              scheduled_report_id: report.id,
              generated_by: report.created_by
            }).select().single()

          if (reportInsertError) throw new Error(`Report DB error: ${reportInsertError.message}`)

          await supabaseClient.from('audit_logs').insert([{
            action: 'REPORT_GENERATED',
            resource: fileName,
            metadata: { scheduled_report_id: report.id }
          }])

          // C. Email Delivery
          const recipientList = (recipients as any) || []
          if (recipientList.length > 0) {
            const emailRes = await fetch('https://api.resend.com/emails', {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${resendApiKey}`,
                'Content-Type': 'application/json'
              },
              body: JSON.stringify({
                from: 'VisionGuard <reports@visionguard.app>',
                to: recipientList,
                subject: `Scheduled Report: ${type} (${format})`,
                html: `<p>Your scheduled ${type} report is ready.</p><p><a href="${fileUrl}">Download ${format}</a></p>`
              })
            })
            if (!emailRes.ok) {
              const emailError = await emailRes.text()
              throw new Error(`Email delivery failed: ${emailError}`)
            }

            await supabaseClient.from('audit_logs').insert([{
              action: 'REPORT_DELIVERED',
              resource: fileName,
              metadata: { recipients: recipientList }
            }])
          }

          success = true
        } catch (err: any) {
          retryCount++
          finalError = err.message
          if (retryCount >= 3) {
            success = false
          }
        }
      }

      // D. Finalize execution
      const duration = Date.now() - startTime
      await supabaseClient.from('report_executions').update({
        completed_at: new Date().toISOString(),
        duration,
        status: success ? 'completed' : 'failed',
        error: success ? null : finalError
      }).eq('id', execution.id)

      if (!success) {
        await supabaseClient.from('audit_logs').insert([{
          action: 'REPORT_FAILED',
          resource: report.name,
          metadata: { scheduled_report_id: report.id, error: finalError }
        }])
      }

      // E. Update next_run_at
      let nextRun = new Date(report.next_run_at)
      const freq = report.frequency
      if (freq === 'Daily') nextRun.setDate(nextRun.getDate() + 1)
      else if (freq === 'Weekly') nextRun.setDate(nextRun.getDate() + 7)
      else if (freq === 'Monthly') nextRun.setMonth(nextRun.getMonth() + 1)
      else nextRun.setDate(nextRun.getDate() + 7) // fallback

      await supabaseClient.from('scheduled_reports').update({
        last_generated_at: new Date().toISOString(),
        next_run_at: nextRun.toISOString()
      }).eq('id', report.id)

      results.push({ id: report.id, success, error: finalError })
    }

    return new Response(JSON.stringify({ processed: dueReports.length, results }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (error: any) {
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 400,
    })
  }
})
