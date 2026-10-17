// components/ui/image-modal.tsx
"use client"

import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog"
import Image from "next/image"

interface ImageModalProps {
  isOpen: boolean
  onClose: () => void
  onCloseAutoFocus?: (event: Event) => void
  imageUrl: string
}

export function ImageModal({ isOpen, onClose, onCloseAutoFocus, imageUrl }: ImageModalProps) {
  return (
    <Dialog open={isOpen} onOpenChange={open => { if (!open) onClose() }}>
      <DialogContent className="max-w-fit" onCloseAutoFocus={onCloseAutoFocus}>
        <DialogTitle className="sr-only">Bild Vorschau</DialogTitle>
        <div className="relative max-h-[80vh] max-w-[80vw]">
          <Image
            src={imageUrl}
            alt="Vergrößertes Bild"
            width={1920}
            height={1080}
            unoptimized
            className="object-contain"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      </DialogContent>
    </Dialog>
  )
}
