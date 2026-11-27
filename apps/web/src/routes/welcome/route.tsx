import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';

import type { ScreenRoute } from '../../app/screen';
import { api, ApiError } from '../../lib/api/client';
import '../signin/signin.css';

const pending = new Map<string, Promise<void>>();

function accept(token: string): Promise<void> {
  let request = pending.get(token);
  if (!request) {
    request = api('/invites/' + encodeURIComponent(token) + '/accept', { method: 'POST' }).then(
      () => {
        pending.delete(token);
      },
      (error: unknown) => {
        pending.delete(token);
        throw error;
      },
    );
    pending.set(token, request);
  }
  return request;
}

export function WelcomeScreen() {
  const [params] = useSearchParams();
  const token = params.get('invite');
  const navigate = useNavigate();
  const [error, setError] = useState('');

  useEffect(() => {
    if (!token) {
      navigate('/', { replace: true });
      return;
    }
    let active = true;
    void accept(token)
      .then(() => {
        if (!active) return;
        navigate('/', { replace: true });
      })
      .catch((reason: unknown) => {
        if (!active) return;
        setError(
          reason instanceof ApiError && reason.status === 409
            ? 'This account already belongs to a family.'
            : 'This invitation could not be accepted. Ask for a new invite.',
        );
      });
    return () => {
      active = false;
    };
  }, [navigate, token]);

  return (
    <main className="auth-screen">
      <section className="auth-card">
        <h1>Welcome</h1>
        {error ? <p role="alert">{error}</p> : <p role="status">Joining…</p>}
      </section>
    </main>
  );
}

export const route: ScreenRoute = { path: '/welcome', element: <WelcomeScreen />, chrome: 'bare', auth: 'required' };
