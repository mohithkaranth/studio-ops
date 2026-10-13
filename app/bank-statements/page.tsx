import {requireStudioSession} from '@/lib/studio-auth-request';
import BankStatements from './BankStatements';
export default async function BankStatementsPage() {
  await requireStudioSession();return <BankStatements/>;
}
