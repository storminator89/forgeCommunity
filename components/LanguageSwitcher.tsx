'use client'

import { useRouter } from 'next/navigation'
import { usePathname } from 'next/navigation'
import { Button } from "@/components/ui/button"
import { 
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

const languages = {
  de: 'Deutsch',
  en: 'English'
}

export function LanguageSwitcher() {
  const router = useRouter()
  const pathname = usePathname()

  const switchLanguage = (locale: string) => {
    const currentPathname = pathname
    const segments = currentPathname.split('/')
    segments[1] = locale
    const newPathname = segments.join('/')
    router.push(newPathname)
  }

  const currentLocale = pathname.split('/')[1] || 'de'

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" className="w-[120px]">
          {languages[currentLocale as keyof typeof languages]}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        {Object.entries(languages).map(([locale, label]) => (
          <DropdownMenuItem
            key={locale}
            onClick={() => switchLanguage(locale)}
          >
            {label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
