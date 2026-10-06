import { useState, useEffect } from 'react'
import { 
  Search, Plus, Users as UsersIcon, Shield,
  CheckCircle2, Edit2, Ban, 
  RefreshCcw, ShieldCheck, Mail, Activity, Eye, Loader2
} from 'lucide-react'
import { cn } from '../lib/utils'
import { supabase } from '../lib/supabase'
import { useAuthStore } from '../store/auth'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { zodResolver } from '@hookform/resolvers/zod'
import { motion, AnimatePresence } from 'framer-motion'

const userSchema = z.object({
  name: z.string().min(2, 'Name is required'),
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
  
  const [activeFilter, setActiveFilter] = useState('All')
  const [searchQuery, setSearchQuery] = useState('')
  
  const { register, handleSubmit, reset, formState: { errors } } = useForm<UserForm>({
    resolver: zodResolver(userSchema)
  })
  const [isSubmitting, setIsSubmitting] = useState(false)

  useEffect(() => {
    fetchData()
    
    // Subscribe to realtime updates for profiles and audit logs
    const channel = supabase.channel('users_management')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'profiles' }, () => fetchData())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'audit_logs' }, () => fetchData())
      .subscribe()
      
    return () => { channel.unsubscribe() }
  }, [])

  const fetchData = async () => {
    const [usersRes, logsRes] = await Promise.all([
      supabase.from('profiles').select('*').order('created_at', { ascending: false }),
      supabase.from('audit_logs').select('*, profiles(name, email)').order('timestamp', { ascending: false }).limit(20)
    ])
    
    if (usersRes.data) setUsers(usersRes.data)
    if (logsRes.data) setAuditLogs(logsRes.data)
      
    setLoading(false)
  }

  // Derived metrics
  const activeUsers = users.filter(u => u.status === 'Active' || !u.status).length
  const disabledUsers = users.filter(u => u.status === 'Disabled').length
  const adminCount = users.filter(u => u.role === 'Admin').length
  const operatorCount = users.filter(u => u.role === 'Operator').length

  const handleOpenCreate = () => {
    reset({ name: '', email: '', organization: '', role: 'Viewer' })
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
    reset({ name: u.name, email: u.email, organization: u.organization || '', role: u.role })
    setDrawerView('edit')
    setIsDrawerOpen(true)
  }

  const onSubmit = async (data: UserForm) => {
    setIsSubmitting(true)
    try {
      if (drawerView === 'create') {
        const { data: response, error } = await supabase.functions.invoke('create-user', {
          body: data
        })

        if (error) {
          throw new Error(error.message || 'Failed to create user')
        }

        if (response?.error) {
          throw new Error(response.error)
        }

        // We fetch data to update the UI
        fetchData()
        
      } else if (drawerView === 'edit' && selectedUser) {
        // Update profile details
        await supabase.from('profiles').update({ ...data }).eq('id', selectedUser.id)
        
        // Log ROLE_CHANGED if role was modified
        if (selectedUser.role !== data.role) {
          await supabase.from('audit_logs').insert([{ user_id: currentUser?.id, action: 'ROLE_CHANGED', metadata: { target_user_id: selectedUser.id, old_role: selectedUser.role, new_role: data.role } }])
        } else {
          await supabase.from('audit_logs').insert([{ user_id: currentUser?.id, action: `Updated profile for ${data.email}` }])
        }

        fetchData()
      }
      setIsDrawerOpen(false)
    } catch (err: any) {
      console.error(err)
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleToggleStatus = async (u: any) => {
    const newStatus = u.status === 'Disabled' ? 'Active' : 'Disabled'
    try {
      if (typeof window !== 'undefined' && window.confirm && !window.confirm(`Are you sure you want to ${newStatus === 'Disabled' ? 'disable' : 'enable'} this account?`)) {
        return
      }
    } catch {
      // Continue safely if window.confirm is restricted in iframe
    }
    
    await supabase.from('profiles').update({ status: newStatus }).eq('id', u.id)
    await supabase.from('audit_logs').insert([{ 
      user_id: currentUser?.id, 
      action: newStatus === 'Disabled' ? 'USER_DISABLED' : 'USER_ENABLED',
      metadata: { target_user_id: u.id, email: u.email }
    }])
    
    // In a real production backend, you would also call supabase.auth.admin.updateUserById({ ban_duration }) 
    // to actually revoke the JWT immediately. We simulate the disable via profiles.status here.
    if (selectedUser?.id === u.id) {
      setSelectedUser({ ...u, status: newStatus })
    }
  }

  const filteredUsers = users.filter(u => {
    const matchesSearch = (u.name || '').toLowerCase().includes(searchQuery.toLowerCase()) || 
                          (u.email || '').toLowerCase().includes(searchQuery.toLowerCase())
    if (!matchesSearch) return false
    
    if (activeFilter === 'Active') return u.status === 'Active' || !u.status
    if (activeFilter === 'Disabled') return u.status === 'Disabled'
    if (activeFilter === 'Pending') return u.status === 'Pending'
    if (['Admin', 'Operator', 'Viewer'].includes(activeFilter)) return u.role === activeFilter
    
    return true
  })

  if (currentUserRole !== 'Admin') {
    return (
      <div className="h-[calc(100vh-136px)] flex items-center justify-center">
        <div className="text-center">
          <ShieldAlert className="w-12 h-12 text-red-500 mx-auto mb-4" />
          <h2 className="text-2xl font-bold text-slate-900 mb-2">Access Denied</h2>
          <p className="text-slate-500">You do not have permission to view the User Management console.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6 max-w-[1600px]">
      
      {/* Dashboard KPI Row */}
      <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
        {[
          { label: 'Total Users', value: users.length, color: 'text-blue-600', bg: 'bg-blue-50' },
          { label: 'Active Sessions', value: activeUsers, color: 'text-emerald-600', bg: 'bg-emerald-50' },
          { label: 'Administrators', value: adminCount, color: 'text-purple-600', bg: 'bg-purple-50' },
          { label: 'Operators', value: operatorCount, color: 'text-amber-600', bg: 'bg-amber-50' },
          { label: 'Disabled Accounts', value: disabledUsers, color: 'text-red-600', bg: 'bg-red-50' }
        ].map((kpi, i) => (
          <div key={i} className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm flex flex-col justify-center">
            <span className="text-[12px] font-bold text-slate-400 uppercase tracking-wider mb-2">{kpi.label}</span>
            <div className={cn("text-3xl font-bold", kpi.color)}>{kpi.value}</div>
          </div>
        ))}
      </div>

      <div className="flex gap-6 h-[calc(100vh-280px)]">
        
        {/* Main User Table */}
        <div className={cn("flex-1 bg-white border border-slate-200 rounded-xl shadow-sm flex flex-col transition-all duration-300", isDrawerOpen ? "hidden lg:flex lg:w-2/3" : "w-full")}>
          
          <div className="p-4 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex flex-wrap items-center gap-2">
              {['All', 'Active', 'Pending', 'Disabled', 'Admin', 'Operator', 'Viewer'].map(filter => (
                <button
                  key={filter}
                  onClick={() => setActiveFilter(filter)}
                  className={cn(
                    "px-3 py-1.5 rounded-lg text-[13px] font-semibold transition-all cursor-pointer",
                    activeFilter === filter 
                      ? "bg-slate-900 text-white shadow-sm" 
                      : "text-slate-600 hover:bg-slate-100"
                  )}
                >
                  {filter}
                </button>
              ))}
            </div>
            
            <div className="flex items-center gap-3">
              <div className="relative">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input 
                  type="text" 
                  placeholder="Search users..." 
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-48 xl:w-64 pl-9 pr-4 py-2 bg-white border border-slate-200 rounded-lg text-[13px] text-slate-900 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all shadow-sm"
                />
              </div>

              <button 
                onClick={() => { setDrawerView('permissions'); setIsDrawerOpen(true); }}
                className="p-2 text-slate-500 hover:text-slate-900 hover:bg-slate-100 rounded-lg border border-slate-200 shadow-sm transition-colors cursor-pointer"
                title="View Permission Matrix"
              >
                <ShieldCheck className="w-4 h-4" />
              </button>

              <button 
                onClick={handleOpenCreate}
                className="flex items-center gap-2 py-2 px-3 bg-blue-600 border border-blue-600 rounded-lg text-[13px] font-bold text-white hover:bg-blue-700 transition-colors shadow-sm cursor-pointer"
              >
                <Plus className="w-4 h-4" /> Invite User
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-auto relative">
            {loading ? (
              <div className="absolute inset-0 flex items-center justify-center">
                <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
              </div>
            ) : filteredUsers.length === 0 ? (
              <div className="absolute inset-0 flex flex-col items-center justify-center text-center p-6 bg-slate-50/50">
                <div className="w-16 h-16 bg-white rounded-full flex items-center justify-center mb-4 border border-slate-200 shadow-sm">
                  <UsersIcon className="w-8 h-8 text-slate-400" />
                </div>
                <h3 className="text-lg font-bold text-slate-900 mb-2">No Users Found</h3>
                <p className="text-slate-500 max-w-sm text-[14px] mb-6">
                  {searchQuery ? "No users match your search criteria." : "Create your first team member to begin collaborating."}
                </p>
              </div>
            ) : (
              <table className="w-full text-left border-collapse whitespace-nowrap">
                <thead className="sticky top-0 bg-slate-50 z-10 shadow-[0_1px_0_rgba(226,232,240,1)]">
                  <tr>
                    <th className="px-5 py-3.5 text-[12px] font-bold text-slate-500 uppercase tracking-wider">User</th>
                    <th className="px-5 py-3.5 text-[12px] font-bold text-slate-500 uppercase tracking-wider">Role & Org</th>
                    <th className="px-5 py-3.5 text-[12px] font-bold text-slate-500 uppercase tracking-wider">Status</th>
                    <th className="px-5 py-3.5 text-[12px] font-bold text-slate-500 uppercase tracking-wider">Last Activity</th>
                    <th className="px-5 py-3.5 text-[12px] font-bold text-slate-500 uppercase tracking-wider text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredUsers.map((u) => {
                    const status = u.status || 'Active'
                    return (
                      <tr key={u.id} className="transition-colors hover:bg-slate-50/80 group">
                        <td className="px-5 py-3.5 cursor-pointer" onClick={() => handleOpenDetails(u)}>
                          <div className="flex items-center gap-3">
                            <div className="w-8 h-8 rounded-full bg-slate-200 text-slate-700 flex items-center justify-center font-bold text-[12px] shrink-0 uppercase border border-white shadow-sm">
                              {u.name?.charAt(0) || u.email?.charAt(0) || 'U'}
                            </div>
                            <div>
                              <div className="font-bold text-[14px] text-slate-900">{u.name || 'Pending User'}</div>
                              <div className="text-[12px] text-slate-500">{u.email}</div>
                            </div>
                          </div>
                        </td>
                        <td className="px-5 py-3.5">
                          <div className="font-semibold text-[13px] text-slate-700">{u.role}</div>
                          <div className="text-[12px] text-slate-500">{u.organization || '---'}</div>
                        </td>
                        <td className="px-5 py-3.5">
                          <span className={cn(
                            "inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-bold uppercase tracking-wider gap-1.5",
                            status === 'Active' ? "bg-emerald-50 text-emerald-700 border border-emerald-200" :
                            status === 'Pending' ? "bg-amber-50 text-amber-700 border border-amber-200" :
                            "bg-slate-100 text-slate-600 border border-slate-300"
                          )}>
                            <div className={cn("w-1.5 h-1.5 rounded-full", 
                              status === 'Active' ? "bg-emerald-500" : 
                              status === 'Pending' ? "bg-amber-500" : "bg-slate-500"
                            )}></div>
                            {status}
                          </span>
                        </td>
                        <td className="px-5 py-3.5 text-[13px] text-slate-600">
                          {u.last_login ? new Date(u.last_login).toLocaleString() : 'Never'}
                        </td>
                        <td className="px-5 py-3.5 text-right">
                          <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                            <button 
                              onClick={() => handleOpenDetails(u)}
                              className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors cursor-pointer"
                              title="View Details"
                            >
                              <Eye className="w-4 h-4" />
                            </button>
                            <button 
                              onClick={() => handleOpenEdit(u)}
                              className="p-1.5 text-slate-400 hover:text-slate-900 hover:bg-slate-100 rounded-lg transition-colors cursor-pointer"
                              title="Edit User"
                            >
                              <Edit2 className="w-4 h-4" />
                            </button>
                            <button 
                              onClick={() => handleToggleStatus(u)}
                              className={cn("p-1.5 rounded-lg transition-colors cursor-pointer", status === 'Disabled' ? "text-emerald-600 hover:bg-emerald-50" : "text-slate-400 hover:text-red-600 hover:bg-red-50")}
                              title={status === 'Disabled' ? 'Re-enable Account' : 'Disable Account'}
                            >
                              {status === 'Disabled' ? <RefreshCcw className="w-4 h-4" /> : <Ban className="w-4 h-4" />}
                            </button>
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

        {/* Side Drawer */}
        <AnimatePresence>
          {isDrawerOpen && (
            <motion.div 
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 20 }}
              className="w-full lg:w-96 flex-shrink-0 bg-white border border-slate-200 rounded-xl shadow-sm flex flex-col overflow-hidden relative z-20"
            >
              <div className="p-5 border-b border-slate-100 flex items-center justify-between bg-slate-50/50 shrink-0">
                <h2 className="text-[15px] font-bold text-slate-900 flex items-center gap-2">
                  {drawerView === 'create' && <Plus className="w-4 h-4" />}
                  {drawerView === 'edit' && <Edit2 className="w-4 h-4" />}
                  {drawerView === 'details' && <UsersIcon className="w-4 h-4" />}
                  {drawerView === 'permissions' && <Shield className="w-4 h-4" />}
                  {drawerView === 'create' ? 'Invite User' : 
                   drawerView === 'edit' ? 'Edit User Profile' : 
                   drawerView === 'permissions' ? 'Permission Matrix' :
                   'User Details'}
                </h2>
                <button 
                  onClick={() => setIsDrawerOpen(false)}
                  className="p-1 text-slate-400 hover:text-slate-600 hover:bg-slate-200 rounded transition-colors cursor-pointer"
                >
                  ×
                </button>
              </div>

              {/* Form Views (Create / Edit) */}
              {(drawerView === 'create' || drawerView === 'edit') && (
                <div className="flex-1 overflow-y-auto flex flex-col">
                  <form id="user-form" onSubmit={handleSubmit(onSubmit)} className="p-5 space-y-4 flex-1">
                    <div>
                      <label className="block text-[12px] font-bold text-slate-700 mb-1.5 uppercase tracking-wide">Full Name</label>
                      <input 
                        {...register('name')}
                        className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-[13px] focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500" 
                        placeholder="John Doe"
                      />
                      {errors.name && <p className="text-[11px] text-red-500 mt-1">{errors.name.message}</p>}
                    </div>

                    <div>
                      <label className="block text-[12px] font-bold text-slate-700 mb-1.5 uppercase tracking-wide">Email Address</label>
                      <input 
                        {...register('email')}
                        disabled={drawerView === 'edit'}
                        className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-[13px] focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 disabled:bg-slate-50 disabled:text-slate-500" 
                        placeholder="john@example.com"
                      />
                      {errors.email && <p className="text-[11px] text-red-500 mt-1">{errors.email.message}</p>}
                    </div>

                    <div>
                      <label className="block text-[12px] font-bold text-slate-700 mb-1.5 uppercase tracking-wide">Organization</label>
                      <input 
                        {...register('organization')}
                        className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-[13px] focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500" 
                        placeholder="Dept of Transportation"
                      />
                    </div>

                    <div>
                      <label className="block text-[12px] font-bold text-slate-700 mb-1.5 uppercase tracking-wide">Platform Role</label>
                      <select 
                        {...register('role')}
                        className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-[13px] focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500" 
                      >
                        <option value="Viewer">Viewer (Read-only)</option>
                        <option value="Operator">Operator (Manage Incidents & Cameras)</option>
                        <option value="Supervisor">Supervisor (Reports & Review Queue)</option>
                        <option value="Admin">Admin (Full System Control)</option>
                      </select>
                    </div>

                    {drawerView === 'create' && (
                      <div className="bg-blue-50 border border-blue-100 rounded-lg p-3 mt-6 flex items-start gap-3">
                        <Mail className="w-5 h-5 text-blue-600 shrink-0 mt-0.5" />
                        <div className="text-[12px] text-blue-800">
                          <p className="font-bold mb-1">Email Invitation</p>
                          <p>An email containing a secure signup link will be sent to this user. They will remain in 'Pending' status until accepted.</p>
                        </div>
                      </div>
                    )}
                  </form>
                  
                  <div className="p-4 border-t border-slate-100 bg-slate-50 shrink-0 flex gap-2">
                    <button 
                      onClick={() => setIsDrawerOpen(false)}
                      className="flex-1 px-4 py-2 bg-white border border-slate-200 text-slate-700 rounded-lg text-[13px] font-bold hover:bg-slate-50 cursor-pointer transition-colors"
                    >
                      Cancel
                    </button>
                    <button 
                      type="submit"
                      form="user-form"
                      disabled={isSubmitting}
                      className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg text-[13px] font-bold hover:bg-blue-700 cursor-pointer transition-colors flex items-center justify-center disabled:opacity-50"
                    >
                      {isSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : (drawerView === 'create' ? 'Send Invite' : 'Save Changes')}
                    </button>
                  </div>
                </div>
              )}

              {/* Details View */}
              {drawerView === 'details' && selectedUser && (
                <div className="flex-1 overflow-y-auto flex flex-col">
                  <div className="p-6 border-b border-slate-100 flex flex-col items-center text-center bg-slate-50/50">
                    <div className="w-20 h-20 rounded-full bg-slate-200 text-slate-700 flex items-center justify-center font-bold text-2xl uppercase border-4 border-white shadow-sm mb-3">
                      {selectedUser.name?.charAt(0) || selectedUser.email?.charAt(0) || 'U'}
                    </div>
                    <h3 className="text-xl font-bold text-slate-900">{selectedUser.name || 'Pending User'}</h3>
                    <p className="text-[14px] text-slate-500 mb-3">{selectedUser.email}</p>
                    
                    <span className={cn(
                      "inline-flex items-center px-3 py-1 rounded-full text-[12px] font-bold uppercase tracking-wider gap-1.5",
                      (selectedUser.status || 'Active') === 'Active' ? "bg-emerald-50 text-emerald-700" :
                      selectedUser.status === 'Pending' ? "bg-amber-50 text-amber-700" : "bg-slate-100 text-slate-600"
                    )}>
                      {selectedUser.status || 'Active'}
                    </span>
                  </div>

                  <div className="p-5 space-y-6 flex-1 bg-white">
                    
                    <div>
                      <h4 className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-3">Profile Information</h4>
                      <div className="bg-slate-50 border border-slate-100 rounded-lg divide-y divide-slate-100">
                        <div className="p-3 flex justify-between">
                          <span className="text-[13px] text-slate-500 font-medium">Role</span>
                          <span className="text-[13px] font-bold text-slate-900">{selectedUser.role}</span>
                        </div>
                        <div className="p-3 flex justify-between">
                          <span className="text-[13px] text-slate-500 font-medium">Organization</span>
                          <span className="text-[13px] font-medium text-slate-900">{selectedUser.organization || 'None'}</span>
                        </div>
                        <div className="p-3 flex justify-between">
                          <span className="text-[13px] text-slate-500 font-medium">Joined</span>
                          <span className="text-[13px] font-medium text-slate-900">{new Date(selectedUser.created_at).toLocaleDateString()}</span>
                        </div>
                      </div>
                    </div>

                    <div>
                      <h4 className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-3 flex items-center gap-2">
                        <Activity className="w-3.5 h-3.5" /> Recent Audit Activity
                      </h4>
                      <div className="space-y-3">
                        {auditLogs.filter(l => l.user_id === selectedUser.id).length === 0 ? (
                           <div className="text-[13px] text-slate-500 italic p-3 bg-slate-50 rounded-lg">No recent activity.</div>
                        ) : (
                          auditLogs.filter(l => l.user_id === selectedUser.id).slice(0, 5).map((log, i) => (
                            <div key={i} className="flex gap-3 relative">
                              <div className="w-1.5 h-1.5 rounded-full bg-blue-500 mt-1.5 relative z-10 shrink-0"></div>
                              {i !== 4 && <div className="absolute left-[3px] top-3 bottom-[-16px] w-px bg-slate-200"></div>}
                              <div>
                                <p className="text-[13px] text-slate-900 font-medium">{log.action}</p>
                                <p className="text-[11px] text-slate-500">{new Date(log.timestamp).toLocaleString()}</p>
                              </div>
                            </div>
                          ))
                        )}
                      </div>
                    </div>

                  </div>

                  <div className="p-4 border-t border-slate-100 bg-slate-50 shrink-0 grid grid-cols-2 gap-2">
                    <button 
                      onClick={() => handleOpenEdit(selectedUser)}
                      className="px-4 py-2 bg-white border border-slate-200 text-slate-700 rounded-lg text-[13px] font-bold hover:bg-slate-50 cursor-pointer transition-colors"
                    >
                      Edit Profile
                    </button>
                    <button 
                      onClick={() => handleToggleStatus(selectedUser)}
                      className={cn(
                        "px-4 py-2 text-white rounded-lg text-[13px] font-bold cursor-pointer transition-colors",
                        selectedUser.status === 'Disabled' ? "bg-emerald-600 hover:bg-emerald-700" : "bg-red-600 hover:bg-red-700"
                      )}
                    >
                      {selectedUser.status === 'Disabled' ? 'Re-enable' : 'Disable Account'}
                    </button>
                  </div>
                </div>
              )}

              {/* Permissions Viewer */}
              {drawerView === 'permissions' && (
                <div className="flex-1 overflow-y-auto p-5 bg-slate-50/50">
                  <h3 className="text-base font-bold text-slate-900 mb-4">Role Permission Matrix</h3>
                  
                  <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="bg-slate-50">
                          <th className="p-3 text-[12px] font-bold text-slate-500 uppercase border-b border-slate-200">Capability</th>
                          <th className="p-3 text-[12px] font-bold text-slate-500 uppercase border-b border-slate-200 text-center">Viewer</th>
                          <th className="p-3 text-[12px] font-bold text-slate-500 uppercase border-b border-slate-200 text-center">Op</th>
                          <th className="p-3 text-[12px] font-bold text-slate-500 uppercase border-b border-slate-200 text-center">Admin</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 text-[13px]">
                        {[
                          { cap: 'View Dashboard', v: true, o: true, a: true },
                          { cap: 'Monitor Cameras', v: true, o: true, a: true },
                          { cap: 'View Incidents', v: true, o: true, a: true },
                          { cap: 'Generate Reports', v: false, o: true, a: true },
                          { cap: 'Resolve Incidents', v: false, o: true, a: true },
                          { cap: 'Add/Edit Cameras', v: false, o: true, a: true },
                          { cap: 'Delete Cameras', v: false, o: false, a: true },
                          { cap: 'Manage Users', v: false, o: false, a: true },
                          { cap: 'System Config', v: false, o: false, a: true },
                        ].map((row, i) => (
                          <tr key={i} className="hover:bg-slate-50 transition-colors">
                            <td className="p-3 font-medium text-slate-700">{row.cap}</td>
                            <td className="p-3 text-center">{row.v ? <CheckCircle2 className="w-4 h-4 text-emerald-500 mx-auto" /> : <span className="text-slate-300">-</span>}</td>
                            <td className="p-3 text-center">{row.o ? <CheckCircle2 className="w-4 h-4 text-emerald-500 mx-auto" /> : <span className="text-slate-300">-</span>}</td>
                            <td className="p-3 text-center">{row.a ? <CheckCircle2 className="w-4 h-4 text-emerald-500 mx-auto" /> : <span className="text-slate-300">-</span>}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <p className="text-[12px] text-slate-500 mt-4 text-center">
                    Permissions are strictly enforced via Postgres Row Level Security (RLS) on all database operations.
                  </p>
                </div>
              )}

            </motion.div>
          )}
        </AnimatePresence>

      </div>
    </div>
  )
}

// Add ShieldAlert icon import since it was missing in the top block
import { ShieldAlert } from 'lucide-react'
