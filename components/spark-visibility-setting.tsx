'use client';

import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { setSparkVisible, useSparkVisibility } from '@/hooks/useSparkVisibility';

/** Uses the existing browser-local choice, independently of account saves. */
export function SparkVisibilitySetting() {
  const { visible } = useSparkVisibility();
  return <div className="flex min-w-0 items-center justify-between gap-4">
    <div className="min-w-0">
      <Label htmlFor="spark-visible" className="flex min-h-11 items-center">Spark anzeigen</Label>
      <p id="spark-visibility-description" className="text-sm text-muted-foreground">Gilt sofort in diesem Browser.</p>
    </div>
    <Switch id="spark-visible" checked={visible} onCheckedChange={setSparkVisible}
      aria-describedby="spark-visibility-description"
      className="relative before:absolute before:-inset-y-3 before:inset-x-0" />
  </div>;
}
