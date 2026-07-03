import Link from 'next/link'

import AcuitySyncForm from '@/app/components/AcuitySyncForm'

export default function AcuitySyncPage() {
  return (
    <div className="mx-auto w-full max-w-4xl space-y-8 px-6 py-12 sm:px-10 lg:px-12">
      <header className="space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight text-zinc-50">Sync Acuity Data</h1>
        <p className="text-sm text-zinc-400">
          Manually sync Acuity appointments for the previous month, current month, and next two months.
        </p>
      </header>

      <AcuitySyncForm />

      <Link href="/" className="inline-block text-sm text-zinc-300 hover:text-zinc-100">
        ← Back to Dashboard
      </Link>
    </div>
  )
}
