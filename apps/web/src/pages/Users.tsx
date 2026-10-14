import { useState, useEffect, useMemo } from 'react'
import { 
  Search, Plus, Users as UsersIcon, Shield,
  CheckCircle2, Edit2, Ban, ShieldCheck, Mail, Activity, Eye, 
  Loader2, X, AlertTriangle, Check, RotateCcw, ShieldAlert,
  UserCheck, UserX, Clock, Building
} from 'lucide-react'
import { cn } from '../lib/utils'
import { supabase } from '../lib/supabase'
import { useAuthStore } from '../store/auth'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { zodResolver } from '@hookform/resolvers/zod'
import { format as formatDate, formatDistanceToNow } from 'date-fns'

const userSchema = z.object({
  name: z.string().min(2, 'Name is required (at least 2 characters)'),
  email: z.string().email('Valid email required'),
  organization: z.string().optional(),
  role: z.enum(['Viewer', 'Operator', 'Supervisor', 'Admin']),
})
type UserForm = z.infer<typeof userSchema>

export function Users() {
  const { role: currentUserRole, user: currentUser } = useAuthStore()
  const [users, setUsers] = useState<any[]>([])
  const [auditLogs, setAuditLogs] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  
  // Drawer States
  const [isDrawerOpen, setIsDrawerOpen] = useState(false)
  const [drawerView, setDrawerView] = useState<'create' | 'edit' | 'details' | 'permissions'>('details')
  const [selectedUser, setSelectedUser] = useState<any | null>(null)
  
  // Confirmation Modal State (Explicit confirmation for privilege/status changes)
  const [confirmModal, setConfirmModal] = useState<{
    isOpen: boolean
    title: string
    description: string
    action: () => Promise<void>
    isDestructive?: boolean
  }>({
    isOpen: false,
    title: '',
    description: '',
    action: async () => {},
    isDestructive: false
  })

  // Filters
  const [searchQuery, setSearchQuery] = useState('')
  const [roleFilter, setRoleFilter] = useState('All')
  const [statusFilter, setStatusFilter] = useState('All')
  
  // Form submission state & feedback
  const [formFeedback, setFormFeedback] = useState<{ text: string; type: 'success' | 'error' } | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  const { register, handleSubmit, reset, formState: { errors } } = useForm<UserForm>({
    resolver: zodResolver(userSchema)
  })

  useEffect(() => {
    fetchData()
    
    // Subscribe to realtime updates for profiles
    const channel = supabase.channel('users_management')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'profiles' }, () => fetchData())
      .subscribe()
      
    return () => { channel.unsubscribe() }
  }, [])

  const fetchData = async () => {
    try {
      const [usersRes, logsRes] = await Promise.all([
        supabase.from('profiles').select('*').order('created_at', { ascending: false }),
        supabase.from('audit_logs').select('*, profiles(name, email)').order('timestamp', { ascending: false }).limit(50)
      ])
      
      if (usersRes.data) setUsers(usersRes.data)
      if (logsRes.data) setAuditLogs(logsRes.data)
    } catch (err) {
      console.warn('Error fetching users:', err)
    } finally {
      setLoading(false)
    }
  }

  // Filtered users list
  const filteredUsers = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    return users.filter(u => {
      // 1. Role Filter
      if (roleFilter !== 'All' && u.role !== roleFilter) return false

      // 2. Status Filter
      if (statusFilter !== 'All') {
        const s = u.status || 'Active'
        if (statusFilter === 'Active' && s !== 'Active') return false
        if (statusFilter === 'Disabled' && s !== 'Disabled') return false
      }

      // 3. Search Query
      if (q) {
        const matchName = u.name?.toLowerCase().includes(q)
        const matchEmail = u.email?.toLowerCase().includes(q)
        const matchOrg = u.organization?.toLowerCase().includes(q)
        const matchRole = u.role?.toLowerCase().includes(q)
        if (!matchName && !matchEmail && !matchOrg && !matchRole) return false
      }

      return true
    })
  }, [users, searchQuery, roleFilter, statusFilter])

  // Overview Metrics
  const activeCount = users.filter(u => (u.status || 'Active') === 'Active').length
  const disabledCount = users.filter(u => u.status === 'Disabled').length
  const adminCount = users.filter(u => u.role === 'Admin').length
  const supervisorCount = users.filter(u => u.role === 'Supervisor').length
  const operatorCount = users.filter(u => u.role === 'Operator').length
  const viewerCount = users.filter(u => u.role === 'Viewer').length

  const handleOpenCreate = () => {
    reset({ name: '', email: '', organization: '', role: 'Viewer' })
    setFormFeedback(null)
    setDrawerView('create')
    setIsDrawerOpen(true)
  }

  const handleOpenDetails = (u: any) => {
    setSelectedUser(u)
    setDrawerView('details')
    setIsDrawerOpen(true)
  }

  const handleOpenEdit = (u: any) => {
    setSelectedUser(u)
    reset({ name: u.name || '', email: u.email || '', organization: u.organization || '', role: u.role || 'Viewer' })
    setFormFeedback(null)
    setDrawerView('edit')
    setIsDrawerOpen(true)
  }

  const onSubmit = async (data: UserForm) => {
    setIsSubmitting(true)
    setFormFeedback(null)

    try {
      if (drawerView === 'create') {
        // Provision user via existing Edge Function
        const { data: response, error } = await supabase.functions.invoke('create-user', {
          body: data
        })

        if (error) {
          throw new Error(error.message || 'Failed to provision user')
        }

        if (response?.error) {
          throw new Error(response.error)
        }

        // Record audit event
        await supabase.from('audit_logs').insert([{
          user_id: currentUser?.id,
          action: 'USER_CREATED',
          metadata: { created_email: data.email, assigned_role: data.role, organization: data.organization }
        }])

        setFormFeedback({ text: `User ${data.email} successfully provisioned.`, type: 'success' })
        await fetchData()
        setTimeout(() => {
          setIsDrawerOpen(false)
          setFormFeedback(null)
        }, 1500)

      } else if (drawerView === 'edit' && selectedUser) {
        // Check self-modification guard: Cannot change own role
        if (selectedUser.id === currentUser?.id && selectedUser.role !== data.role) {
          throw new Error('Self-promotion/demotion restricted: You cannot modify your own administrative role.')
        }

        // Update profile
        const { error: updErr } = await supabase.from('profiles').update({
          name: data.name,
          organization: data.organization,
          role: data.role
        }).eq('id', selectedUser.id)

        if (updErr) throw updErr

        // Audit log role change or profile update
        if (selectedUser.role !== data.role) {
          await supabase.from('audit_logs').insert([{
            user_id: currentUser?.id,
            action: 'ROLE_CHANGED',
            metadata: { target_user_id: selectedUser.id, target_email: selectedUser.email, old_role: selectedUser.role, new_role: data.role }
          }])
        } else {
          await supabase.from('audit_logs').insert([{
            user_id: currentUser?.id,
            action: 'PROFILE_UPDATED',
            metadata: { target_user_id: selectedUser.id, target_email: selectedUser.email }
          }])
        }

        setFormFeedback({ text: 'User profile updated successfully.', type: 'success' })
        await fetchData()
        setTimeout(() => {
          setIsDrawerOpen(false)
          setFormFeedback(null)
        }, 1500)
      }
    } catch (err: any) {
      console.error('User submission failed:', err)
      setFormFeedback({ text: err.message || 'Operation failed.', type: 'error' })
    } finally {
      setIsSubmitting(false)
    }
  }

  // Explicit confirmation modal trigger for status change
  const triggerStatusToggle = (u: any) => {
    // Prevent self-disabling
    if (u.id === currentUser?.id) {
      alert('Security policy violation: You cannot disable your own active administrator account.')
      return
    }

    const newStatus = u.status === 'Disabled' ? 'Active' : 'Disabled'
    const isDisabling = newStatus === 'Disabled'

    setConfirmModal({
      isOpen: true,
      title: isDisabling ? 'Disable User Account' : 'Re-enable User Account',
      description: isDisabling
        ? `Are you sure you want to disable ${u.name || u.email}? The user will immediately be blocked from logging into VisionGuard.`
        : `Re-enable account for ${u.name || u.email}? The user will regain access according to their assigned role (${u.role}).`,
      isDestructive: isDisabling,
      action: async () => {
        const { error: err } = await supabase.from('profiles').update({ status: newStatus }).eq('id', u.id)
        if (err) throw err

        await supabase.from('audit_logs').insert([{ 
          user_id: currentUser?.id, 
          action: isDisabling ? 'USER_DISABLED' : 'USER_ENABLED',
          metadata: { target_user_id: u.id, email: u.email }
        }])

        await fetchData()
        if (selectedUser?.id === u.id) {
          setSelectedUser({ ...selectedUser, status: newStatus })
        }
      }
    })
  }

  return (
    <div className="space-y-6 max-w-[1700px] mx-auto pb-12">
      
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 pb-2 border-b border-slate-200">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-2xl font-bold tracking-tight text-slate-900">User Management</h1>
            <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-indigo-50 text-indigo-700 border border-indigo-200">
              Role-Based Access Control
            </span>
          </div>
          <p className="text-sm text-slate-500 mt-1">
            Provision staff accounts, manage role assignments, and review security access permissions.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={() => { setDrawerView('permissions'); setIsDrawerOpen(true); }}
            className="flex items-center gap-2 px-3 py-2 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 rounded-lg text-xs font-semibold shadow-2xs transition-colors cursor-pointer"
          >
            <Shield className="w-3.5 h-3.5 text-slate-500" />
            <span>Role Permissions Matrix</span>
          </button>

          <button 
            onClick={handleOpenCreate}
            className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-3.5 py-2 rounded-lg text-xs font-bold transition-all shadow-2xs cursor-pointer"
          >
            <Plus className="w-4 h-4" /> Provision New User
          </button>
        </div>
      </div>

      {/* Overview KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="p-4 bg-white border border-slate-200 rounded-xl shadow-2xs">
          <div className="flex items-center justify-between text-slate-500 mb-2">
            <span className="text-[11px] font-bold uppercase tracking-wider">Total Accounts</span>
            <UsersIcon className="w-4 h-4 text-blue-600" />
          </div>
          <div className="text-2xl font-bold text-slate-900">{users.length}</div>
          <div className="text-[10px] text-slate-500 mt-0.5">{activeCount} Active • {disabledCount} Disabled</div>
        </div>

        <div className="p-4 bg-white border border-slate-200 rounded-xl shadow-2xs">
          <div className="flex items-center justify-between text-slate-500 mb-2">
            <span className="text-[11px] font-bold uppercase tracking-wider">Administrators</span>
            <ShieldCheck className="w-4 h-4 text-indigo-600" />
          </div>
          <div className="text-2xl font-bold text-indigo-700">{adminCount}</div>
          <div className="text-[10px] text-slate-500 mt-0.5">Full governance and configuration access</div>
        </div>

        <div className="p-4 bg-white border border-slate-200 rounded-xl shadow-2xs">
          <div className="flex items-center justify-between text-slate-500 mb-2">
            <span className="text-[11px] font-bold uppercase tracking-wider">Supervisors & Ops</span>
            <Activity className="w-4 h-4 text-amber-600" />
          </div>
          <div className="text-2xl font-bold text-amber-700">{supervisorCount + operatorCount}</div>
          <div className="text-[10px] text-slate-500 mt-0.5">{supervisorCount} Supervisors • {operatorCount} Operators</div>
        </div>

        <div className="p-4 bg-white border border-slate-200 rounded-xl shadow-2xs">
          <div className="flex items-center justify-between text-slate-500 mb-2">
            <span className="text-[11px] font-bold uppercase tracking-wider">Viewers</span>
            <Eye className="w-4 h-4 text-slate-500" />
          </div>
          <div className="text-2xl font-bold text-slate-700">{viewerCount}</div>
          <div className="text-[10px] text-slate-500 mt-0.5">Read-only operational and intelligence access</div>
        </div>
      </div>

      {/* Filter Toolbar */}
      <div className="bg-white border border-slate-200 rounded-xl p-3.5 shadow-2xs flex flex-col md:flex-row gap-3 items-stretch md:items-center justify-between">
        <div className="flex flex-wrap items-center gap-2.5 flex-1">
          <div className="relative min-w-[240px] max-w-sm flex-1">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input 
              type="text" 
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Search by name, email, organization, or role..." 
              className="w-full pl-9 pr-3 py-1.5 text-xs bg-slate-50 focus:bg-white border border-slate-200 rounded-lg text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
            />
          </div>

          <select
            value={roleFilter}
            onChange={e => setRoleFilter(e.target.value)}
            className="px-2.5 py-1.5 bg-white border border-slate-200 rounded-lg text-xs font-medium text-slate-700 outline-none hover:border-slate-300 focus:border-blue-500 cursor-pointer shadow-2xs"
          >
            <option value="All">All Roles</option>
            <option value="Admin">Admin</option>
            <option value="Supervisor">Supervisor</option>
            <option value="Operator">Operator</option>
            <option value="Viewer">Viewer</option>
          </select>

          <select
            value={statusFilter}
            onChange={e => setStatusFilter(e.target.value)}
            className="px-2.5 py-1.5 bg-white border border-slate-200 rounded-lg text-xs font-medium text-slate-700 outline-none hover:border-slate-300 focus:border-blue-500 cursor-pointer shadow-2xs"
          >
            <option value="All">All Statuses</option>
            <option value="Active">Active Accounts</option>
            <option value="Disabled">Disabled Accounts</option>
          </select>
        </div>

        <div className="flex items-center gap-2 self-end md:self-auto shrink-0">
          {(searchQuery || roleFilter !== 'All' || statusFilter !== 'All') && (
            <button
              onClick={() => { setSearchQuery(''); setRoleFilter('All'); setStatusFilter('All'); }}
              className="flex items-center gap-1 px-2.5 py-1 text-xs text-rose-600 hover:text-rose-700 hover:bg-rose-50 rounded-lg font-medium transition-colors cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Reset</span>
            </button>
          )}
          <span className="text-xs font-medium text-slate-500">
            {filteredUsers.length} user{filteredUsers.length === 1 ? '' : 's'}
          </span>
        </div>
      </div>

      {/* Users Table */}
      <div className="bg-white border border-slate-200 rounded-xl shadow-2xs overflow-hidden">
        <div className="overflow-x-auto min-h-[300px]">
          {loading ? (
            <div className="h-64 flex flex-col items-center justify-center text-slate-400">
              <Loader2 className="w-8 h-8 animate-spin text-blue-600 mb-2" />
              <p className="text-xs font-medium text-slate-500">Loading user profiles from directory...</p>
            </div>
          ) : filteredUsers.length === 0 ? (
            <div className="h-64 flex flex-col items-center justify-center text-slate-400 p-8 text-center">
              <UsersIcon className="w-10 h-10 opacity-30 mb-2" />
              <h3 className="text-sm font-bold text-slate-700">No Users Found</h3>
              <p className="text-xs text-slate-500 mt-0.5">Try clearing search filters or provision a new user.</p>
            </div>
          ) : (
            <table className="w-full text-left border-collapse text-xs whitespace-nowrap">
              <thead className="bg-slate-50 border-b border-slate-200 text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                <tr>
                  <th className="px-5 py-3.5">User Identity</th>
                  <th className="px-5 py-3.5">Role</th>
                  <th className="px-5 py-3.5">Organization</th>
                  <th className="px-5 py-3.5">Status</th>
                  <th className="px-5 py-3.5">Created</th>
                  <th className="px-5 py-3.5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredUsers.map((u) => {
                  const isCurrent = u.id === currentUser?.id
                  const s = u.status || 'Active'
                  const isDisabled = s === 'Disabled'

                  return (
                    <tr key={u.id} className="hover:bg-slate-50/80 transition-colors">
                      {/* Name & Email */}
                      <td className="px-5 py-3.5">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-full bg-slate-900 text-white flex items-center justify-center font-bold text-xs uppercase shrink-0">
                            {u.name ? u.name.charAt(0) : u.email?.charAt(0) || 'U'}
                          </div>
                          <div>
                            <div className="font-bold text-slate-900 flex items-center gap-1.5">
                              <span>{u.name || 'Unnamed Staff Member'}</span>
                              {isCurrent && (
                                <span className="px-1.5 py-0.2 rounded text-[9px] font-bold bg-slate-100 text-slate-600 border border-slate-200">
                                  You
                                </span>
                              )}
                            </div>
                            <div className="text-[11px] text-slate-500 font-mono mt-0.5">{u.email}</div>
                          </div>
                        </div>
                      </td>

                      {/* Role Badge */}
                      <td className="px-5 py-3.5">
                        <span className={cn(
                          "inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider",
                          u.role === 'Admin' ? "bg-indigo-100 text-indigo-800 border border-indigo-200" :
                          u.role === 'Supervisor' ? "bg-purple-100 text-purple-800 border border-purple-200" :
                          u.role === 'Operator' ? "bg-blue-100 text-blue-800 border border-blue-200" :
                          "bg-slate-100 text-slate-700 border border-slate-200"
                        )}>
                          {u.role || 'Viewer'}
                        </span>
                      </td>

                      {/* Organization */}
                      <td className="px-5 py-3.5 text-slate-600">
                        {u.organization || '—'}
                      </td>

                      {/* Status */}
                      <td className="px-5 py-3.5">
                        <span className={cn(
                          "inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[11px] font-semibold",
                          isDisabled 
                            ? "bg-slate-100 text-slate-600 border border-slate-200"
                            : "bg-emerald-50 text-emerald-700 border border-emerald-200"
                        )}>
                          <span className={cn(
                            "w-1.5 h-1.5 rounded-full",
                            isDisabled ? "bg-slate-400" : "bg-emerald-500"
                          )} />
                          <span>{isDisabled ? 'Disabled' : 'Active'}</span>
                        </span>
                      </td>

                      {/* Created / Invited Date */}
                      <td className="px-5 py-3.5 text-slate-500">
                        {u.created_at ? formatDate(new Date(u.created_at), 'MMM d, yyyy') : '—'}
                      </td>

                      {/* Actions */}
                      <td className="px-5 py-3.5 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            onClick={() => handleOpenDetails(u)}
                            className="p-1 text-slate-400 hover:text-slate-800 transition-colors cursor-pointer"
                            title="Inspect Profile"
                          >
                            <Eye className="w-4 h-4" />
                          </button>

                          <button
                            onClick={() => handleOpenEdit(u)}
                            className="p-1 text-slate-400 hover:text-blue-600 transition-colors cursor-pointer"
                            title="Edit Role & Details"
                          >
                            <Edit2 className="w-4 h-4" />
                          </button>

                          {!isCurrent && (
                            <button
                              onClick={() => triggerStatusToggle(u)}
                              className={cn(
                                "p-1 transition-colors cursor-pointer",
                                isDisabled ? "text-emerald-600 hover:text-emerald-700" : "text-slate-400 hover:text-rose-600"
                              )}
                              title={isDisabled ? "Re-enable Account" : "Disable Account"}
                            >
                              <Ban className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Slide-out Drawer (Create / Edit / Details / Permissions) */}
      {isDrawerOpen && (
        <div className="fixed inset-0 z-50 overflow-hidden bg-black/40 backdrop-blur-2xs flex justify-end animate-in fade-in duration-200">
          <div 
            className="w-full max-w-lg bg-white shadow-2xl flex flex-col h-full border-l border-slate-200 animate-in slide-in-from-right duration-200"
            onClick={e => e.stopPropagation()}
          >
            {/* Drawer Header */}
            <div className="p-5 border-b border-slate-100 flex items-center justify-between bg-slate-50/70">
              <div>
                <h3 className="text-sm font-bold text-slate-900">
                  {drawerView === 'create' && 'Provision New Staff User'}
                  {drawerView === 'edit' && `Edit Profile: ${selectedUser?.name || selectedUser?.email}`}
                  {drawerView === 'details' && `Account Inspection: ${selectedUser?.name || selectedUser?.email}`}
                  {drawerView === 'permissions' && 'Role Capabilities & Access Matrix'}
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  {drawerView === 'create' && 'Create a verified user via Supabase provisioning service.'}
                  {drawerView === 'edit' && 'Update identity and assign operational role permissions.'}
                  {drawerView === 'details' && 'Inspect user details, metadata, and audit log history.'}
                  {drawerView === 'permissions' && 'Role-Based Access Control policy matrix.'}
                </p>
              </div>
              <button
                onClick={() => setIsDrawerOpen(false)}
                className="text-slate-400 hover:text-slate-800 p-1.5 rounded-lg cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Feedback Banner */}
            {formFeedback && (
              <div className={cn(
                "p-3 mx-5 mt-4 rounded-lg border text-xs font-medium flex items-center gap-2",
                formFeedback.type === 'success'
                  ? "bg-emerald-50 text-emerald-800 border-emerald-200"
                  : "bg-rose-50 text-rose-800 border-rose-200"
              )}>
                {formFeedback.type === 'success' ? <Check className="w-4 h-4 shrink-0 text-emerald-600" /> : <AlertTriangle className="w-4 h-4 shrink-0 text-rose-600" />}
                <span>{formFeedback.text}</span>
              </div>
            )}

            {/* Drawer Body */}
            <div className="flex-1 overflow-y-auto p-5 text-xs">
              
              {/* Form View (Create or Edit) */}
              {(drawerView === 'create' || drawerView === 'edit') && (
                <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
                  <div>
                    <label className="block font-bold text-slate-700 mb-1">Full Name *</label>
                    <input 
                      type="text" 
                      {...register('name')}
                      placeholder="e.g. Sarah Jenkins"
                      className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                    />
                    {errors.name && <span className="text-rose-600 text-[11px] mt-0.5 block">{errors.name.message}</span>}
                  </div>

                  <div>
                    <label className="block font-bold text-slate-700 mb-1">Email Address *</label>
                    <input 
                      type="email" 
                      {...register('email')}
                      disabled={drawerView === 'edit'}
                      placeholder="e.g. sarah.jenkins@visionguard.internal"
                      className="w-full px-3 py-2 bg-white disabled:bg-slate-50 border border-slate-200 rounded-lg text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                    />
                    {errors.email && <span className="text-rose-600 text-[11px] mt-0.5 block">{errors.email.message}</span>}
                  </div>

                  <div>
                    <label className="block font-bold text-slate-700 mb-1">Organization / Unit</label>
                    <input 
                      type="text" 
                      {...register('organization')}
                      placeholder="e.g. Traffic Management Bureau"
                      className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                    />
                  </div>

                  <div>
                    <label className="block font-bold text-slate-700 mb-1">Assigned Role *</label>
                    <select
                      {...register('role')}
                      disabled={drawerView === 'edit' && selectedUser?.id === currentUser?.id}
                      className="w-full px-3 py-2 bg-white disabled:bg-slate-50 border border-slate-200 rounded-lg text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 font-medium"
                    >
                      <option value="Viewer">Viewer (Read-only observation)</option>
                      <option value="Operator">Operator (Video review & incident resolution)</option>
                      <option value="Supervisor">Supervisor (Case management & queue approvals)</option>
                      <option value="Admin">Admin (Full administrative & configuration governance)</option>
                    </select>
                    {drawerView === 'edit' && selectedUser?.id === currentUser?.id && (
                      <p className="text-[11px] text-amber-600 mt-1">
                        Self-protection lock: You cannot modify your own administrative role.
                      </p>
                    )}
                  </div>

                  <div className="pt-4 border-t border-slate-100 flex items-center justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => setIsDrawerOpen(false)}
                      className="px-3.5 py-2 bg-white border border-slate-200 text-slate-700 rounded-lg font-semibold cursor-pointer hover:bg-slate-50"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={isSubmitting}
                      className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-bold cursor-pointer disabled:opacity-50 shadow-2xs"
                    >
                      {isSubmitting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                      <span>{drawerView === 'create' ? 'Provision User' : 'Save Changes'}</span>
                    </button>
                  </div>
                </form>
              )}

              {/* Details Inspection View */}
              {drawerView === 'details' && selectedUser && (
                <div className="space-y-4">
                  <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-slate-800 text-sm">{selectedUser.name || 'Staff User'}</span>
                      <span className={cn(
                        "px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider",
                        selectedUser.role === 'Admin' ? "bg-indigo-100 text-indigo-800 border border-indigo-200" :
                        selectedUser.role === 'Supervisor' ? "bg-purple-100 text-purple-800 border border-purple-200" :
                        selectedUser.role === 'Operator' ? "bg-blue-100 text-blue-800 border border-blue-200" :
                        "bg-slate-100 text-slate-700 border border-slate-200"
                      )}>
                        {selectedUser.role}
                      </span>
                    </div>
                    
                    <div className="space-y-1.5 text-slate-600 pt-1">
                      <div className="flex items-center justify-between">
                        <span className="text-slate-400">Email:</span>
                        <span className="font-mono text-slate-800 font-medium">{selectedUser.email}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-slate-400">Organization:</span>
                        <span className="text-slate-800 font-medium">{selectedUser.organization || '—'}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-slate-400">Account Status:</span>
                        <span className="font-semibold text-slate-800">{selectedUser.status || 'Active'}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-slate-400">Created:</span>
                        <span className="text-slate-800">{selectedUser.created_at ? formatDate(new Date(selectedUser.created_at), 'PPP') : '—'}</span>
                      </div>
                    </div>
                  </div>

                  {/* Audit History for this user */}
                  <div>
                    <h4 className="font-bold text-slate-700 uppercase tracking-wider text-[11px] mb-2">
                      Recent Activity Trail
                    </h4>
                    <div className="border border-slate-200 rounded-xl overflow-hidden divide-y divide-slate-100 bg-white">
                      {auditLogs.filter(l => l.user_id === selectedUser.id).slice(0, 5).length === 0 ? (
                        <div className="p-4 text-center text-slate-400">No recorded audit actions for this user</div>
                      ) : (
                        auditLogs.filter(l => l.user_id === selectedUser.id).slice(0, 5).map(l => (
                          <div key={l.id} className="p-2.5 flex items-center justify-between">
                            <div>
                              <span className="font-semibold text-slate-800 block">{l.action}</span>
                              <span className="text-[10px] text-slate-400 font-mono">
                                {formatDate(new Date(l.timestamp || l.created_at), 'MMM d, h:mm a')}
                              </span>
                            </div>
                            <span className="text-[10px] bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded">Logged</span>
                          </div>
                        ))
                      )}
                    </div>
                  </div>

                  <div className="pt-3 flex items-center justify-end gap-2">
                    <button
                      onClick={() => handleOpenEdit(selectedUser)}
                      className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-bold shadow-2xs"
                    >
                      Edit Profile & Role
                    </button>
                  </div>
                </div>
              )}

              {/* Permissions Viewer */}
              {drawerView === 'permissions' && (
                <div className="space-y-4">
                  <div className="border border-slate-200 rounded-xl overflow-hidden bg-white">
                    <table className="w-full text-left border-collapse text-xs">
                      <thead className="bg-slate-50 border-b border-slate-200 text-[11px] font-bold text-slate-500 uppercase">
                        <tr>
                          <th className="p-3">Platform Capability</th>
                          <th className="p-3 text-center">Viewer</th>
                          <th className="p-3 text-center">Operator</th>
                          <th className="p-3 text-center">Supervisor</th>
                          <th className="p-3 text-center">Admin</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {[
                          { cap: 'View Dashboard & Analytics', v: true, o: true, s: true, a: true },
                          { cap: 'View Incident Center', v: true, o: true, s: true, a: true },
                          { cap: 'Resolve / Reject Review Queue', v: false, o: true, s: true, a: true },
                          { cap: 'Create & Manage Cases', v: true, o: true, s: true, a: true },
                          { cap: 'Approve & Close Cases', v: false, o: false, s: true, a: true },
                          { cap: 'Executive Intelligence Access', v: true, o: true, s: true, a: true },
                          { cap: 'Generate & Export Reports', v: true, o: true, s: true, a: true },
                          { cap: 'User Provisioning & Roles', v: false, o: false, s: false, a: true },
                          { cap: 'System Configuration', v: false, o: false, s: false, a: true },
                          { cap: 'Audit Trail Inspection', v: false, o: false, s: false, a: true },
                        ].map((row, i) => (
                          <tr key={i} className="hover:bg-slate-50">
                            <td className="p-3 font-medium text-slate-800">{row.cap}</td>
                            <td className="p-3 text-center">{row.v ? <Check className="w-3.5 h-3.5 text-emerald-600 mx-auto" /> : <span className="text-slate-300">—</span>}</td>
                            <td className="p-3 text-center">{row.o ? <Check className="w-3.5 h-3.5 text-emerald-600 mx-auto" /> : <span className="text-slate-300">—</span>}</td>
                            <td className="p-3 text-center">{row.s ? <Check className="w-3.5 h-3.5 text-emerald-600 mx-auto" /> : <span className="text-slate-300">—</span>}</td>
                            <td className="p-3 text-center">{row.a ? <Check className="w-3.5 h-3.5 text-emerald-600 mx-auto" /> : <span className="text-slate-300">—</span>}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <p className="text-[11px] text-slate-400 text-center">
                    Permissions are enforced at the database layer via PostgreSQL Row Level Security (RLS).
                  </p>
                </div>
              )}

            </div>
          </div>
        </div>
      )}

      {/* Confirmation Modal */}
      {confirmModal.isOpen && (
        <div className="fixed inset-0 z-50 overflow-hidden bg-black/50 backdrop-blur-2xs flex items-center justify-center p-4 animate-in fade-in duration-200">
          <div className="bg-white rounded-xl border border-slate-200 shadow-2xl max-w-md w-full p-5 space-y-4">
            <div className="flex items-start gap-3">
              <div className={cn(
                "w-9 h-9 rounded-lg flex items-center justify-center shrink-0 mt-0.5",
                confirmModal.isDestructive ? "bg-rose-100 text-rose-600" : "bg-blue-100 text-blue-600"
              )}>
                <AlertTriangle className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-slate-900">{confirmModal.title}</h3>
                <p className="text-xs text-slate-600 mt-1 leading-relaxed">{confirmModal.description}</p>
              </div>
            </div>

            <div className="pt-2 flex items-center justify-end gap-2">
              <button
                onClick={() => setConfirmModal(prev => ({ ...prev, isOpen: false }))}
                className="px-3.5 py-1.5 bg-white border border-slate-200 text-slate-700 rounded-lg text-xs font-semibold hover:bg-slate-50 cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={async () => {
                  try {
                    await confirmModal.action()
                    setConfirmModal(prev => ({ ...prev, isOpen: false }))
                  } catch (e: any) {
                    alert(e.message || 'Operation failed')
                  }
                }}
                className={cn(
                  "px-3.5 py-1.5 rounded-lg text-xs font-bold text-white cursor-pointer shadow-2xs",
                  confirmModal.isDestructive ? "bg-rose-600 hover:bg-rose-700" : "bg-blue-600 hover:bg-blue-700"
                )}
              >
                Confirm Action
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  )
}
export default Users
