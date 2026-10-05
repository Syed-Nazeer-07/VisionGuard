import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { cn } from '../../lib/utils'


const registerSchema = z.object({
  email: z.string().email('Please enter a valid email address'),
  password: z.string().min(6, 'Password must be at least 6 characters'),
  confirmPassword: z.string(),
  role: z.enum(['Viewer', 'Operator', 'Supervisor', 'Admin'] as const),
}).refine((data) => data.password === data.confirmPassword, {
  message: "Passwords don't match",
  path: ["confirmPassword"],
})

type RegisterForm = z.infer<typeof registerSchema>

export function Register() {
  const navigate = useNavigate()
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [successMsg, setSuccessMsg] = useState<string | null>(null)

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<RegisterForm>({
    resolver: zodResolver(registerSchema),
    defaultValues: { role: 'Viewer' }
  })

  const onSubmit = async (data: RegisterForm) => {
    setIsLoading(true)
    setError(null)
    setSuccessMsg(null)
    
    const { error } = await supabase.auth.signUp({
      email: data.email,
      password: data.password,
      options: {
        data: {
          role: data.role
        }
      }
    })

    setIsLoading(false)

    if (error) {
      setError(error.message)
    } else {
      setSuccessMsg('Registration successful! You can now log in.')
      setTimeout(() => navigate('/login'), 2000)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-950 text-white p-4">
      <div className="w-full max-w-md p-8 bg-gray-900 border border-gray-800 rounded-lg shadow-xl">
        <h2 className="text-2xl font-bold mb-6 text-center">Create Account</h2>
        
        {error && (
          <div className="mb-4 p-3 bg-red-500/10 border border-red-500/50 text-red-400 rounded text-sm">
            {error}
          </div>
        )}
        {successMsg && (
          <div className="mb-4 p-3 bg-green-500/10 border border-green-500/50 text-green-400 rounded text-sm">
            {successMsg}
          </div>
        )}

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">Email</label>
            <input
              type="email"
              {...register('email')}
              className={cn(
                "w-full px-3 py-2 bg-gray-950 border rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-colors",
                errors.email ? "border-red-500" : "border-gray-800"
              )}
            />
            {errors.email && <p className="mt-1 text-xs text-red-400">{errors.email.message}</p>}
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Password</label>
            <input
              type="password"
              {...register('password')}
              className={cn(
                "w-full px-3 py-2 bg-gray-950 border rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-colors",
                errors.password ? "border-red-500" : "border-gray-800"
              )}
            />
            {errors.password && <p className="mt-1 text-xs text-red-400">{errors.password.message}</p>}
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Confirm Password</label>
            <input
              type="password"
              {...register('confirmPassword')}
              className={cn(
                "w-full px-3 py-2 bg-gray-950 border rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-colors",
                errors.confirmPassword ? "border-red-500" : "border-gray-800"
              )}
            />
            {errors.confirmPassword && <p className="mt-1 text-xs text-red-400">{errors.confirmPassword.message}</p>}
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Role Request</label>
            <select
              {...register('role')}
              className={cn(
                "w-full px-3 py-2 bg-gray-950 border rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-colors",
                errors.role ? "border-red-500" : "border-gray-800"
              )}
            >
              <option value="Viewer">Viewer</option>
              <option value="Operator">Operator</option>
              <option value="Supervisor">Supervisor</option>
              <option value="Admin">Admin</option>
            </select>
            {errors.role && <p className="mt-1 text-xs text-red-400">{errors.role.message}</p>}
          </div>

          <div className="flex justify-between items-center text-sm">
            <Link to="/login" className="text-gray-400 hover:text-gray-300">Already have an account?</Link>
          </div>

          <button
            type="submit"
            disabled={isLoading}
            className="w-full py-2 px-4 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed rounded-md font-medium transition-colors"
          >
            {isLoading ? 'Registering...' : 'Register'}
          </button>
        </form>
      </div>
    </div>
  )
}
