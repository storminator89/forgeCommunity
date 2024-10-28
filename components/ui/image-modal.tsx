// components/ui/image-modal.tsx
"use client"

import { Dialog, DialogContent } from "@/components/ui/dialog"
import Image from "next/image"

interface ImageModalProps {
  isOpen: boolean
  onClose: () => void
  imageUrl: string
}

export function ImageModal({ isOpen, onClose, imageUrl }: ImageModalProps) {
  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-fit">
        <div className="relative max-h-[80vh] max-w-[80vw]">
          <Image
            src={imageUrl}
            alt="Vergrößertes Bild"
            width={1920}
            height={1080}
            className="object-contain"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      </DialogContent>
    </Dialog>
  )
}