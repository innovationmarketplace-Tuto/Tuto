import { StudentRouteGate } from '@/features/student/student-route-gate';
import { StudentWorksheetScreen } from '@/features/student/student-worksheet-screen';

export default function WorksheetRoute() {
  return (
    <StudentRouteGate>
      {(profile) => <StudentWorksheetScreen profile={profile} />}
    </StudentRouteGate>
  );
}
