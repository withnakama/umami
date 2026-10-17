import type { Metadata } from 'next';
import { LoginPage } from './LoginPage';

export const dynamic = 'force-dynamic';

export default async function () {
  if (process.env.DISABLE_LOGIN) {
    return null;
  }

  return <LoginPage />;
}

export const metadata: Metadata = {
  title: 'Login',
};
