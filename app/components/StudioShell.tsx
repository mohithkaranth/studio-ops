'use client';
import {usePathname} from 'next/navigation';
import Sidebar from './Sidebar';
import AcuitySyncNotifier from './AcuitySyncNotifier';
export default function StudioShell({children}:{children:React.ReactNode}) {
  if(usePathname()==='/login')return <>{children}</>;
  return <div className="flex min-h-full"><Sidebar/><AcuitySyncNotifier/><main className="min-w-0 flex-1 pt-14 lg:pt-0">{children}</main></div>;
}
