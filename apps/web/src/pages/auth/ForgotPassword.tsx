import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Link } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { cn } from '../../lib/utils'

const forgotSchema = z.object({
  email: z.string().email('Please enter a valid email address'),
})

type ForgotForm = z.infer<typeof forgotSchema>

export function ForgotPassword() {
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<ForgotForm>({
    resolver: zodResolver(forgotSchema),
  })

  const onSubmit = async (data: ForgotForm) => {
    setIsLoading(true)
    setError(null)
    setSuccess(null)
    
    const { error } = await supabase.auth.resetPasswordForEmail(data.email, {
      redirectTo: `${window.location.origin}/reset-password`,
    })

    setIsLoading(false)

    if (error) {
      setError(error.message)
    } else {
      setSuccess('Check your email for the password reset link.')
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-950 text-white p-4">
      <div className="w-full max-w-md p-8 bg-gray-900 border border-gray-800 rounded-lg shadow-xl">
        <h2 className="text-2xl font-bold mb-6 text-center">Reset Password</h2>
        
        {error && (
          <div className="mb-4 p-3 bg-red-500/10 border border-red-500/50 text-red-400 rounded text-sm">
            {error}
          </div>
        )}
        {success && (
          <div className="mb-4 p-3 bg-green-500/10 border border-green-500/50 text-green-400 rounded text-sm">
            {success}
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

          <div className="flex justify-between items-center text-sm">
            <Link to="/login" className="text-gray-400 hover:text-gray-300">Back to login</Link>
          </div>

          <button
            type="submit"
            disabled={isLoading}
            className="w-full py-2 px-4 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed rounded-md font-medium transition-colors"
          >
            {isLoading ? 'Sending...' : 'Send Reset Link'}
          </button>
        </form>
      </div>
    </div>
  )
}
