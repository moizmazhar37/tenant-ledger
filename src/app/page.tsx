import { redirect } from 'next/navigation';
import { currentSession } from '@/lib/auth/server';

export default async function HomePage() {
  redirect((await currentSession()) ? '/dashboard' : '/login');
}
