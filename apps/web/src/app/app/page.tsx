import { redirect } from 'next/navigation';
import { APP_HOME } from '@/lib/routes';

export default function AppIndex() {
  redirect(APP_HOME);
}
