import { Skeleton, SkeletonRows } from '@/components/ui/bits';

/** Shown while a module's code loads on first visit (Next streams it), shaped like a page. */
export default function Loading() {
  return (
    <div className="flex flex-col gap-5 pt-2" aria-busy>
      <Skeleton className="h-8 w-40" />
      <Skeleton className="h-12 w-full !rounded-orv-md" />
      <SkeletonRows rows={5} />
    </div>
  );
}
