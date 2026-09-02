import { redirect } from 'next/navigation';
import { APP_ROUTES } from '@/lib/routes';

export default function DashboardRedirectPage() {
  redirect(APP_ROUTES.overview);
}
