import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { CheckCircle2, KeyRound, LockKeyhole, Save, ShieldCheck, UserRound, SlidersHorizontal, HardDrive } from 'lucide-react';
import { useAuthStore } from '../store/auth';
import { supabase, supabaseConfig } from '../lib/supabase';

type Section = 'profile' | 'workspace' | 'security';
const START_PAGES = [
  { value: '/app', label: 'Overview' },
  { value: '/app/analyze', label: 'Live analysis' },
  { value: '/app/videos', label: 'History' },
  { value: '/app/analytics', label: 'Analytics' },
  { value: '/app/cases', label: 'Incidents' },
  { value: '/app/reports', label: 'Reports' }
];

export default function Settings() {
  const { user, role, profile, settings, updateProfile, updateSettings } = useAuthStore();
  const [section, setSection] = useState<Section>('profile');
  const [name, setName] = useState('');
  const [organization, setOrganization] = useState('');
  const [timezone, setTimezone] = useState('UTC');
  const [startPage, setStartPage] = useState('/app');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<{ text: string; ok: boolean } | null>(null);

  useEffect(() => {
    setName(profile?.name || user?.user_metadata?.full_name || '');
    setOrganization(profile?.organization || '');
    setTimezone(profile?.timezone || 'UTC');
    const destination = settings?.default_landing_page || '/app';
    setStartPage(START_PAGES.some(item => item.value === destination) ? destination : '/app');
  }, [user?.id, user?.user_metadata?.full_name, profile, settings]);

  const save = async () => {
    if (!user || saving) return;
    setFeedback(null);
    if (supabaseConfig.isMock) {
      setFeedback({ok:false,text:'Settings require a connected Supabase account.'});
      return;
    }
    setSaving(true);
    try {
      if (section === 'profile') {
        const values = {
          name: name.trim(),
          organization: organization.trim(),
          timezone
        };
        if (values.name.length < 2) throw Error('Enter a display name of at least two characters.');
        const { error } = await supabase.from('profiles').update(values).eq('id',user.id)
          .select('id').single();
        if (error) throw error;
        updateProfile(values);
      } else if (section === 'workspace') {
        if (!START_PAGES.some(page => page.value === startPage)) {
          throw Error('Select a valid workspace start page.');
        }
        const { error } = await supabase.from('user_settings')
          .upsert({id:user.id,default_landing_page:startPage}, {onConflict:'id'})
          .select('id').single();
        if (error) throw error;
        updateSettings({default_landing_page:startPage});
      } else {
        if (newPassword.length < 8) throw Error('Use at least 8 characters for a new password.');
        if (newPassword !== confirmPassword) throw Error('Passwords do not match.');
        const { error } = await supabase.auth.updateUser({password:newPassword});
        if (error) throw error;
        setNewPassword('');
        setConfirmPassword('');
      }
      setFeedback({ok:true,text:section === 'security' ? 'Password updated.' : 'Changes saved to your account.'});
    } catch (cause) {
      setFeedback({ok:false,text:cause instanceof Error ? cause.message : 'Could not save settings.'});
    } finally {
      setSaving(false);
    }
  };

  const sectionButtons = [
    {id:'profile' as const,label:'Profile',description:'Your account details',icon:UserRound},
    {id:'workspace' as const,label:'Workspace',description:'Starting page and storage',icon:SlidersHorizontal},
    {id:'security' as const,label:'Security',description:'Password and account access',icon:ShieldCheck}
  ];

  return <main className="vg-page">
    <header className="vg-page-header">
      <div><h1>Settings</h1><p>Manage your account and workspace preferences</p></div>
    </header>
    <div className="grid gap-5 lg:grid-cols-[245px_minmax(0,1fr)]">
      <aside className="space-y-3">
        <nav className="vg-panel space-y-1 p-2" aria-label="Settings sections">
          {sectionButtons.map(item => {
            const Icon = item.icon;
            return <button key={item.id} type="button" onClick={() => {
              setSection(item.id);setFeedback(null);
            }} aria-current={section===item.id?'page':undefined}
              className={'flex w-full items-center gap-3 rounded-lg px-3 py-3 text-left transition-colors '+
                (section===item.id?'bg-[#e9f1fb] text-[#1d4f8b]':'text-slate-600 hover:bg-slate-50')}>
              <Icon size={18} className="shrink-0"/>
              <span className="min-w-0">
                <span className="block text-sm font-semibold">{item.label}</span>
                <span className="mt-0.5 block text-[11px] opacity-75">{item.description}</span>
              </span>
            </button>;
          })}
        </nav>
        <section className="vg-panel space-y-2 p-4">
          <p className="text-xs font-semibold text-slate-800">Account access</p>
          <p className="break-all text-xs text-slate-600">{user?.email || 'Not signed in'}</p>
          <span className="inline-flex rounded-md border border-blue-200 bg-blue-50 px-2 py-1 text-[11px] font-semibold text-[#2356a8]">
            {role || 'Viewer'}
          </span>
          <p className="text-[11px] leading-5 text-slate-500">Roles are assigned by an authorized administrator, not from this settings page.</p>
        </section>
      </aside>
      <section className="vg-panel h-fit overflow-hidden">
        <div className="vg-section-head">
          <h2>{sectionButtons.find(item=>item.id===section)?.label}</h2>
        </div>
        <div className="space-y-5 p-5 sm:p-7">
          {section==='profile' && <>
            <p className="text-sm text-slate-500">These details appear with your account and are stored in your workspace profile.</p>
            <div>
              <label htmlFor="settings-name" className="mb-1.5 block text-xs font-semibold text-slate-700">Display name</label>
              <input id="settings-name" className="vg-field w-full" value={name} onChange={e=>setName(e.target.value)} maxLength={120}/>
            </div>
            <div>
              <label htmlFor="settings-organization" className="mb-1.5 block text-xs font-semibold text-slate-700">Organization</label>
              <input id="settings-organization" className="vg-field w-full" value={organization} onChange={e=>setOrganization(e.target.value)} maxLength={200}/>
            </div>
            <div>
              <label htmlFor="settings-timezone" className="mb-1.5 block text-xs font-semibold text-slate-700">Timezone</label>
              <input id="settings-timezone" className="vg-field w-full" value={timezone} onChange={e=>setTimezone(e.target.value)} maxLength={64} placeholder="Asia/Kolkata"/>
              <p className="mt-1.5 text-xs text-slate-500">Example: Asia/Kolkata, UTC, America/New_York</p>
            </div>
          </>}
          {section==='workspace' && <>
            <div>
              <label htmlFor="settings-start" className="mb-1.5 block text-xs font-semibold text-slate-700">Default start page</label>
              <select id="settings-start" className="vg-field w-full" value={startPage} onChange={e=>setStartPage(e.target.value)}>
                {START_PAGES.map(page=><option key={page.value} value={page.value}>{page.label}</option>)}
              </select>
              <p className="mt-2 text-xs text-slate-500">Saved to your account. Different users can choose different pages.</p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-800">
                <HardDrive size={17}/> Video and analysis storage
              </div>
              <p className="mt-2 text-xs leading-6 text-slate-600">
                Analysis sessions and review flags are saved locally and synchronized to your account when cloud metadata is available.
                Original video files are retained on this device only when you choose that option in Live Analysis.
                Backblaze B2 upload is a separate, explicit action.
              </p>
              <Link to="/app/analyze" className="mt-3 inline-flex text-xs font-semibold text-[#2356a8] hover:underline">
                Open video storage controls
              </Link>
            </div>
          </>}
          {section==='security' && <>
            <div className="flex items-center gap-2 text-xs leading-5 text-slate-500">
              <KeyRound size={16}/> Update the password for your currently signed-in account.
            </div>
            <div>
              <label htmlFor="settings-new-password" className="mb-1.5 block text-xs font-semibold text-slate-700">New password</label>
              <input id="settings-new-password" className="vg-field w-full" type="password"
                autoComplete="new-password" value={newPassword} onChange={e=>setNewPassword(e.target.value)}/>
            </div>
            <div>
              <label htmlFor="settings-confirm-password" className="mb-1.5 block text-xs font-semibold text-slate-700">Confirm password</label>
              <input id="settings-confirm-password" className="vg-field w-full" type="password"
                autoComplete="new-password" value={confirmPassword} onChange={e=>setConfirmPassword(e.target.value)}/>
            </div>
            <Link to="/forgot-password" className="text-xs font-semibold text-[#2356a8] hover:underline">
              Use email password recovery instead
            </Link>
          </>}
          {feedback && <div role={feedback.ok?'status':'alert'}
            className={'flex items-start gap-2 rounded-lg border p-3 text-sm '+
              (feedback.ok?'border-emerald-200 bg-emerald-50 text-emerald-800':'border-amber-200 bg-amber-50 text-amber-900')}>
            {feedback.ok && <CheckCircle2 size={18} className="shrink-0"/>}
            <span>{feedback.text}</span>
          </div>}
          <div className="flex justify-end border-t border-slate-100 pt-5">
            <button type="button" onClick={() => void save()} disabled={saving || !user}
              className="vg-primary"><Save size={16}/>{saving?'Saving…':section==='security'?'Update password':'Save changes'}</button>
          </div>
        </div>
      </section>
    </div>
  </main>;
}
