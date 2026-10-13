import {requireStudioSession} from '@/lib/studio-auth-request';
import PasswordForm from './PasswordForm';
export default async function PasswordPage() {
  await requireStudioSession();return <div className="min-h-screen bg-zinc-950 text-zinc-100"><div className="mx-auto max-w-lg px-6 py-12"><h1 className="text-3xl font-semibold">Change password</h1><p className="mt-3 text-sm text-zinc-400">Use at least 15 characters. A passphrase is fine.</p><PasswordForm/></div></div>;
}
