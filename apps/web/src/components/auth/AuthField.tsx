import { useState, type ComponentProps } from 'react';
import { Eye, EyeOff, type LucideIcon } from 'lucide-react';

type Props = Omit<ComponentProps<'input'>, 'id'> & {
  id: string;
  label: string;
  icon: LucideIcon;
  error?: string;
  hint?: string;
};

export function AuthField({ id, label, icon: Icon, error, hint, type, ...input }: Props) {
  const [visible, setVisible] = useState(false);
  const password = type === 'password';
  const describedBy = [hint && id + '-hint', error && id + '-error'].filter(Boolean).join(' ');
  return <div className="vg-auth-field">
    <label htmlFor={id}>{label}</label>
    <div className="vg-auth-input">
      <Icon size={18} aria-hidden="true"/>
      <input {...input} id={id} type={password && visible ? 'text' : type}
        aria-invalid={error ? true : undefined} aria-describedby={describedBy || undefined}/>
      {password && <button type="button" className="vg-auth-visibility" aria-controls={id}
        aria-label={visible ? 'Hide ' + label.toLowerCase() : 'Show ' + label.toLowerCase()}
        onClick={() => setVisible(value => !value)}>
        {visible ? <EyeOff size={18}/> : <Eye size={18}/>}
      </button>}
    </div>
    {hint && <p id={id + '-hint'} className="vg-auth-hint">{hint}</p>}
    {error && <p id={id + '-error'} role="alert" className="vg-auth-field-error">{error}</p>}
  </div>;
}
