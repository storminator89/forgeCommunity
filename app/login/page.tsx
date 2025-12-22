"use client"

import { useState, useEffect, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { signIn } from 'next-auth/react'
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { ThemeToggle } from "@/components/theme-toggle"
import Link from 'next/link'
import { LogIn, ArrowLeft, Loader2, Mail, Lock, Github, Eye, EyeOff } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { z } from "zod"

const loginSchema = z.object({
  email: z.string().email('Bitte geben Sie eine gültige E-Mail-Adresse ein'),
  password: z.string().min(8, 'Das Passwort muss mindestens 8 Zeichen lang sein'),
});

function LoginContent() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const [loginAttempts, setLoginAttempts] = useState(0)
  const [isBlocked, setIsBlocked] = useState(false)
  const [blockTimer, setBlockTimer] = useState(0)
  const router = useRouter()
  const searchParams = useSearchParams()
  const callbackUrl = searchParams.get('callbackUrl') || '/community'

  useEffect(() => {
    let timer: NodeJS.Timeout;
    if (isBlocked && blockTimer > 0) {
      timer = setInterval(() => {
        setBlockTimer((prev) => {
          if (prev <= 1) {
            setIsBlocked(false);
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    }
    return () => clearInterval(timer);
  }, [isBlocked, blockTimer]);

  const validateInput = () => {
    try {
      loginSchema.parse({ email, password });
      return true;
    } catch (err) {
      if (err instanceof z.ZodError) {
        setError(err.errors[0].message);
      }
      return false;
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (isBlocked) {
      setError(`Login temporär gesperrt. Bitte warten Sie ${blockTimer} Sekunden vor dem nächsten Versuch.`);
      return;
    }

    if (!validateInput()) {
      return;
    }

    setError('')
    setIsLoading(true)

    try {
      const result = await signIn('credentials', {
        redirect: false,
        email,
        password,
      })

      if (result?.error) {
        setLoginAttempts((prev) => {
          const newAttempts = prev + 1;
          if (newAttempts >= 5) {
            setIsBlocked(true);
            setBlockTimer(30);
            return 0;
          }
          return newAttempts;
        });

        setError('Anmeldung fehlgeschlagen. Bitte überprüfen Sie Ihre Eingaben.')
      } else if (result?.ok) {
        // Verwende window.location für zuverlässigere Weiterleitung
        window.location.href = callbackUrl
      }
    } catch (err) {
      setError('Ein unerwarteter Fehler ist aufgetreten. Bitte versuchen Sie es später erneut.')
    } finally {
      setIsLoading(false)
    }
  }

  const handleGoogleSignIn = async () => {
    setIsLoading(true)
    try {
      await signIn('google', { callbackUrl })
    } catch (err) {
      setError('Ein Fehler ist bei der Anmeldung mit Google aufgetreten.')
      setIsLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-white via-gray-50 to-blue-50 dark:from-gray-900 dark:via-gray-800 dark:to-blue-900 flex flex-col items-center justify-center p-8 relative overflow-hidden">
      {/* Decorative background elements */}
      <div className="absolute inset-0 bg-grid-black/[0.02] dark:bg-grid-white/[0.02] bg-[size:60px_60px]" />
      <div className="absolute h-full w-full bg-gradient-to-br from-blue-50/50 via-transparent to-purple-50/50 dark:from-blue-900/20 dark:to-purple-900/20" />

      <div className="absolute top-6 right-6 z-50">
        <ThemeToggle />
      </div>

      <div className="relative w-full max-w-[1000px] flex flex-col md:flex-row gap-8 items-center">
        {/* Left side - Branding/Welcome */}
        <div className="w-full md:w-5/12 space-y-6 text-center md:text-left">
          <h1 className="text-4xl md:text-5xl font-bold bg-gradient-to-r from-gray-900 via-blue-800 to-blue-600 dark:from-white dark:via-blue-400 dark:to-blue-300 bg-clip-text text-transparent">
            Willkommen in der Community
          </h1>
          <p className="text-lg text-gray-600 dark:text-gray-300">
            Treten Sie unserer wachsenden Gemeinschaft bei und entdecken Sie neue Möglichkeiten.
          </p>
          <div className="hidden md:block">
            <div className="mt-8 grid grid-cols-2 gap-4">
              <div className="bg-white/50 dark:bg-white/5 backdrop-blur-lg rounded-xl p-4 border border-gray-200/50 dark:border-white/10">
                <div className="text-blue-600 dark:text-blue-400 mb-1">🤝</div>
                <h3 className="font-medium mb-1">Gemeinschaft</h3>
                <p className="text-sm text-gray-600 dark:text-gray-400">Verbinden Sie sich mit Gleichgesinnten</p>
              </div>
              <div className="bg-white/50 dark:bg-white/5 backdrop-blur-lg rounded-xl p-4 border border-gray-200/50 dark:border-white/10">
                <div className="text-purple-600 dark:text-purple-400 mb-1">💡</div>
                <h3 className="font-medium mb-1">Inspiration</h3>
                <p className="text-sm text-gray-600 dark:text-gray-400">Teilen Sie Ihre Ideen</p>
              </div>
            </div>
          </div>
        </div>

        {/* Right side - Login Form */}
        <Card className="w-full md:w-7/12 shadow-2xl hover:shadow-3xl transition-all duration-300 backdrop-blur-lg bg-white/70 dark:bg-gray-900/50">
          <CardHeader className="space-y-1 pb-6">
            <CardTitle className="text-2xl font-bold text-center">
              Anmelden
            </CardTitle>
            <CardDescription className="text-center text-gray-500 dark:text-gray-400">
              Melden Sie sich an, um auf Ihr Konto zuzugreifen
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-8">
            <form onSubmit={handleSubmit} className="space-y-6">
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="email" className="text-sm font-medium inline-block">
                    E-Mail
                    <span className="text-red-500 ml-1" aria-hidden="true">*</span>
                  </Label>
                  <div className="relative group">
                    <Mail className="absolute left-3 top-1/2 transform -translate-y-1/2 h-5 w-5 text-gray-400 group-hover:text-blue-500 transition-colors duration-200" />
                    <Input
                      id="email"
                      type="email"
                      placeholder="name@example.com"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="pl-12 h-12 bg-white dark:bg-gray-900 border-gray-200 dark:border-gray-700 focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400 rounded-lg transition-all duration-200"
                      required
                      aria-required="true"
                      aria-invalid={error && error.includes('E-Mail') ? 'true' : 'false'}
                      aria-describedby={error && error.includes('E-Mail') ? 'email-error' : undefined}
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="password" className="text-sm font-medium inline-block">
                    Passwort
                    <span className="text-red-500 ml-1" aria-hidden="true">*</span>
                  </Label>
                  <div className="relative group">
                    <Lock className="absolute left-3 top-1/2 transform -translate-y-1/2 h-5 w-5 text-gray-400 group-hover:text-blue-500 transition-colors duration-200" />
                    <Input
                      id="password"
                      type={showPassword ? "text" : "password"}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="pl-12 pr-12 h-12 bg-white dark:bg-gray-900 border-gray-200 dark:border-gray-700 focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400 rounded-lg transition-all duration-200"
                      required
                      aria-required="true"
                      aria-invalid={error && error.includes('Passwort') ? 'true' : 'false'}
                      aria-describedby={error && error.includes('Passwort') ? 'password-error' : undefined}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-blue-500 focus:outline-none"
                      aria-label={showPassword ? "Passwort verbergen" : "Passwort anzeigen"}
                    >
                      {showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                    </button>
                  </div>
                </div>
              </div>

              <AnimatePresence>
                {error && (
                  <motion.div
                    initial={{ opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                    className="bg-red-50 dark:bg-red-900/30 text-red-600 dark:text-red-400 text-sm p-4 rounded-lg"
                  >
                    {error}
                  </motion.div>
                )}
              </AnimatePresence>

              {isBlocked && (
                <motion.div
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="bg-yellow-50 dark:bg-yellow-900/30 text-yellow-600 dark:text-yellow-400 text-sm p-4 rounded-lg"
                >
                  Login temporär gesperrt. Bitte warten Sie {blockTimer} Sekunden.
                </motion.div>
              )}

              <Button
                type="submit"
                className="w-full h-12 bg-gradient-to-r from-blue-600 to-blue-500 hover:from-blue-500 hover:to-blue-400 dark:from-blue-500 dark:to-blue-400 dark:hover:from-blue-400 dark:hover:to-blue-300 text-white font-medium rounded-lg transition-all duration-200"
                disabled={isLoading}
              >
                {isLoading ? (
                  <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                ) : (
                  <LogIn className="mr-2 h-5 w-5" />
                )}
                Anmelden
              </Button>
            </form>

            <div className="space-y-6">
              <div className="flex items-center justify-between w-full text-sm">
                <Link
                  href="/forgot-password"
                  className="text-gray-600 hover:text-blue-500 dark:text-gray-400 dark:hover:text-blue-400 transition-colors duration-200"
                >
                  Passwort vergessen?
                </Link>
                <Link
                  href="/register"
                  className="text-gray-600 hover:text-blue-500 dark:text-gray-400 dark:hover:text-blue-400 transition-colors duration-200"
                >
                  Konto erstellen
                </Link>
              </div>

              <div className="relative">
                <div className="absolute inset-0 flex items-center">
                  <span className="w-full border-t border-gray-200 dark:border-gray-700" />
                </div>
                <div className="relative flex justify-center text-xs uppercase">
                  <span className="bg-white dark:bg-gray-900 px-4 text-gray-500 dark:text-gray-400">
                    Oder
                  </span>
                </div>
              </div>

              <Button
                variant="outline"
                className="w-full h-12 bg-white dark:bg-gray-900 border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 rounded-lg transition-all duration-200"
                onClick={handleGoogleSignIn}
                disabled={isLoading}
              >
                <svg className="mr-2 h-5 w-5" aria-hidden="true" focusable="false" data-prefix="fab" data-icon="google" role="img" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 488 512">
                  <path fill="currentColor" d="M488 261.8C488 403.3 391.1 504 248 504 110.8 504 0 393.2 0 256S110.8 8 248 8c66.8 0 123 24.5 166.3 64.9l-67.5 64.9C258.5 52.6 94.3 116.6 94.3 256c0 86.5 69.1 156.6 153.7 156.6 98.2 0 135-70.4 140.8-106.9H248v-85.3h236.1c2.3 12.7 3.9 24.9 3.9 41.4z"></path>
                </svg>
                Mit Google anmelden
              </Button>

              <div className="flex justify-center mt-6">
                <Link
                  href="/"
                  className="group flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400 hover:text-blue-500 dark:hover:text-blue-400 transition-all duration-300"
                >
                  <ArrowLeft className="h-4 w-4 transform transition-transform duration-300 group-hover:-translate-x-1" />
                  <span className="border-b border-dashed border-current pb-0.5">
                    Zurück zur Startseite
                  </span>
                </Link>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

// Wrapper-Komponente mit Suspense für useSearchParams
export default function LoginPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-gradient-to-br from-white via-gray-50 to-blue-50 dark:from-gray-900 dark:via-gray-800 dark:to-blue-900 flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
      </div>
    }>
      <LoginContent />
    </Suspense>
  )
}