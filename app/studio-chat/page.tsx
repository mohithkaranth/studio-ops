import {requireStudioSession} from '@/lib/studio-auth-request';
import StudioChat from './StudioChat';
export default async function StudioChatPage() {
  await requireStudioSession();return <StudioChat/>;
}
