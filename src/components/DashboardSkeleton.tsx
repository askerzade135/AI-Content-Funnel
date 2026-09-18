import React from 'react';

export function DashboardSkeleton() {
  return (
    <div className="min-h-screen bg-stone-50/50 text-stone-900 flex flex-col font-sans animate-pulse">
      {/* Header Skeleton */}
      <header className="bg-white border-b border-stone-200 sticky top-0 z-30 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center space-x-4">
          <div className="w-8 h-8 bg-stone-200 rounded-lg" />
          <div className="space-y-1.5">
            <div className="w-32 h-4 bg-stone-200 rounded" />
            <div className="w-20 h-3 bg-stone-100 rounded" />
          </div>
        </div>
        <div className="flex items-center space-x-3">
          <div className="w-24 h-9 bg-stone-200 rounded-lg" />
          <div className="w-9 h-9 bg-stone-200 rounded-full" />
        </div>
      </header>

      {/* Main Content Skeleton */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-6 py-8 space-y-6">
        {/* Stats Row Skeleton */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="bg-white p-5 rounded-xl border border-stone-200/80 space-y-3">
              <div className="w-24 h-3 bg-stone-200 rounded" />
              <div className="w-16 h-6 bg-stone-200 rounded" />
            </div>
          ))}
        </div>

        {/* Toolbar & Filter Skeleton */}
        <div className="bg-white p-4 rounded-xl border border-stone-200/80 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="w-full sm:w-80 h-10 bg-stone-100 rounded-lg" />
          <div className="flex items-center space-x-2 w-full sm:w-auto">
            <div className="w-28 h-9 bg-stone-100 rounded-lg" />
            <div className="w-28 h-9 bg-stone-100 rounded-lg" />
          </div>
        </div>

        {/* Video Cards Grid Skeleton */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <div key={i} className="bg-white rounded-2xl border border-stone-200/80 overflow-hidden flex flex-col">
              <div className="w-full h-48 bg-stone-200" />
              <div className="p-5 flex-1 space-y-3">
                <div className="w-20 h-4 bg-stone-100 rounded" />
                <div className="w-full h-5 bg-stone-200 rounded" />
                <div className="w-3/4 h-4 bg-stone-100 rounded" />
                <div className="pt-4 flex items-center justify-between border-t border-stone-100">
                  <div className="w-24 h-3 bg-stone-100 rounded" />
                  <div className="w-16 h-8 bg-stone-200 rounded-lg" />
                </div>
              </div>
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}
