import { StudentChatScreen } from '@/features/student/student-chat-screen';
import { StudentRouteGate } from '@/features/student/student-route-gate';

export default function ChatRoute() {
  return (
    <StudentRouteGate>
      {(profile) => <StudentChatScreen profile={profile} />}
    </StudentRouteGate>
  );
}
