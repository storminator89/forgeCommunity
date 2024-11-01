import { motion, AnimatePresence } from 'framer-motion'

interface PointsAnimationProps {
  points: number
  isVisible: boolean
  onComplete: () => void
}

export function PointsAnimation({ points, isVisible, onComplete }: PointsAnimationProps) {
  return (
    <AnimatePresence>
      {isVisible && (
        <motion.div
          initial={{ opacity: 0, y: 0, scale: 0.5 }}
          animate={{
            opacity: [0, 1, 1, 0],
            y: -100,
            scale: [0.5, 1.2, 1.2, 0.8]
          }}
          transition={{
            duration: 1.5,
            times: [0, 0.2, 0.8, 1]
          }}
          onAnimationComplete={onComplete}
          className="fixed bottom-10 right-10 z-50 flex items-center justify-center"
        >
          <div className="bg-primary text-white px-4 py-2 rounded-full shadow-lg flex items-center space-x-2">
            <span className="text-xl font-bold">+{points}</span>
            <span className="text-sm">Punkte!</span>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
