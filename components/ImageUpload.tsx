"use client"

import { useState, useRef } from 'react'
import { Button } from "@/components/ui/button"
import { toast } from 'react-toastify'
import Image from 'next/image'
import { UserRound } from 'lucide-react'

interface ImageUploadProps {
  currentImage?: string | null
  onImageUpdate: (newImageUrl: string) => void
}

export function ImageUpload({ currentImage, onImageUpdate }: ImageUploadProps) {
  const [isUploading, setIsUploading] = useState(false)
  const [failedImage, setFailedImage] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return

    // Überprüfung der Dateigröße (5MB)
    const maxSize = 5 * 1024 * 1024 // 5MB in Bytes
    if (file.size > maxSize) {
      toast.error("Die Datei ist zu groß. Maximale Größe ist 5MB.")
      return
    }

    // Überprüfung des Dateityps
    const allowedTypes = ['image/jpeg', 'image/png', 'image/gif']
    if (!allowedTypes.includes(file.type)) {
      toast.error("Ungültiger Dateityp. Nur JPEG, PNG und GIF sind erlaubt.")
      return
    }

    setIsUploading(true)

    try {
      const formData = new FormData()
      formData.append('file', file)

      const response = await fetch('/api/upload', {
        method: 'POST',
        body: formData,
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || 'Fehler beim Hochladen')
      }

      const data = await response.json()
      onImageUpdate(data.filePath)
      toast.success("Bild erfolgreich hochgeladen!")
    } catch (error) {
      console.error('Upload error:', error)
      toast.error(error instanceof Error ? error.message : "Fehler beim Hochladen des Bildes")
    } finally {
      setIsUploading(false)
    }
  }

  const triggerFileInput = () => {
    fileInputRef.current?.click()
  }

  return (
    <div className="flex flex-col items-center space-y-4">
      <div className="relative w-32 h-32 rounded-full overflow-hidden">
        {currentImage && currentImage !== failedImage ? <Image
          src={currentImage}
          alt="Profilbild"
          fill
          className="object-cover"
          onError={() => setFailedImage(currentImage)}
        /> : <div role="img" aria-label="Noch kein Profilbild" className="flex h-full w-full items-center justify-center rounded-full bg-accent text-primary"><UserRound className="h-12 w-12" aria-hidden="true" /></div>}
      </div>
      <input
        type="file"
        aria-label="Profilbild auswählen"
        ref={fileInputRef}
        onChange={handleUpload}
        accept="image/jpeg,image/png,image/gif"
        className="hidden"
      />
      <Button
        type="button"
        onClick={triggerFileInput}
        disabled={isUploading}
        variant="outline"
      >
        {isUploading ? 'Wird hochgeladen...' : 'Bild ändern'}
      </Button>
    </div>
  )
}
