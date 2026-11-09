import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router';

import { authClient, authErrorMessage, getAuthCapabilities, safeNext, useSession } from '../../lib/api/auth';
import { PasskeyOffer } from './PasskeyOffer';
import './signin.css';

type Method = 'magic-link' | 'passkey' | 'google';

export function SignInScreen() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const next = safeNext(params.get('next'), '/all');
  const magicCompleted = params.get('magic') === '1';
  const googleFailed = params.has('error');
  const { data: session, isPending: sessionPending } = useSession();
  const [email, setEmail] = useState('');
  // Null until the API says which methods it has; the email form is the fallback while Google is off.
  const [googleAvailable, setGoogleAvailable] = useState<boolean | null>(null);
  const [passkeyAvailable, setPasskeyAvailable] = useState<boolean | null>(null);
  const [pending, setPending] = useState<Method | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [error, setError] = useState('');
  const mounted = useRef(true);
  const finish = useCallback(() => navigate(next, { replace: true }), [navigate, next]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    let current = true;
    void getAuthCapabilities().then(
      ({ providers }) => {
        if (current) setGoogleAvailable(providers.includes('google'));
      },
      () => {
        if (current) setGoogleAvailable(false);
      },
    );
    return () => {
      current = false;
    };
  }, []);

  useEffect(() => {
    if (!('PublicKeyCredential' in window)) {
      setPasskeyAvailable(false);
      return;
    }
    let current = true;
    setPasskeyAvailable(true);
    // Passkey autofill hangs off the email field, which only the fallback form has.
    if (sessionPending || session || googleAvailable !== false) return () => undefined;
    const conditional = PublicKeyCredential.isConditionalMediationAvailable;
    if (!conditional) return () => undefined;
    void conditional.call(PublicKeyCredential).then(async (available) => {
      if (!current || !available) return;
      await authClient.signIn.passkey({ autoFill: true });
    });
    return () => {
      current = false;
    };
  }, [googleAvailable, session, sessionPending]);

  useEffect(() => {
    if (!sessionPending && session && !magicCompleted) finish();
  }, [finish, magicCompleted, session, sessionPending]);

  useEffect(() => {
    if (!sessionPending && session && magicCompleted && passkeyAvailable === false) finish();
  }, [finish, magicCompleted, passkeyAvailable, session, sessionPending]);

  if (sessionPending || (session && (!magicCompleted || passkeyAvailable === null))) return null;
  if (session && magicCompleted && passkeyAvailable) return <PasskeyOffer onDone={finish} />;
  if (session && magicCompleted) return null;
  if (googleAvailable === null) return null;

  async function run(method: Method, action: () => Promise<{ error: unknown }>) {
    setPending(method);
    setError('');
    try {
      const result = await action();
      if (result.error) throw result.error;
    } catch (caught) {
      if (!mounted.current) return;
      setError(authErrorMessage(caught, `Could not start ${methodLabel(method)} sign-in.`));
    } finally {
      if (mounted.current) setPending(null);
    }
  }

  async function sendMagicLink(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const callback = new URL('/signin', window.location.origin);
    callback.searchParams.set('next', next);
    callback.searchParams.set('magic', '1');
    const submittedEmail = email;
    await run('magic-link', async () => {
      const result = await authClient.signIn.magicLink({ email: submittedEmail, callbackURL: callback.href });
      if (!result.error && mounted.current) setSentTo(submittedEmail);
      return result;
    });
  }

  if (sentTo) {
    return (
      <main className="auth-screen signin-screen">
        <section className="auth-card">
          <div role="status">
            <h1>Check your email</h1>
            <p>Open the sign-in link we sent to {sentTo}.</p>
          </div>
          <button className="auth-skip" type="button" onClick={() => setSentTo(null)}>
            Use another email
          </button>
        </section>
      </main>
    );
  }

  const passkeyButton = passkeyAvailable && (
    <button
      className="auth-method"
      disabled={pending !== null}
      type="button"
      onClick={() => void run('passkey', () => authClient.signIn.passkey())}
    >
      {pending === 'passkey' ? 'Opening passkey…' : 'Use a passkey'}
    </button>
  );
  const errorMessage = error || (googleFailed ? 'Could not sign in with Google.' : '');
  const errorAlert = errorMessage && (
    <p className="auth-error" role="alert">
      {errorMessage}
    </p>
  );

  if (googleAvailable) {
    const errorCallback = new URL('/signin', window.location.origin);
    errorCallback.searchParams.set('next', next);
    return (
      <main className="auth-screen signin-screen">
        <section className="auth-card">
          <h1>Sign in</h1>
          <div className="auth-methods">
            <button
              className="auth-primary"
              disabled={pending !== null}
              type="button"
              onClick={() =>
                void run('google', () =>
                  authClient.signIn.social({
                    provider: 'google',
                    callbackURL: next,
                    errorCallbackURL: `${errorCallback.pathname}${errorCallback.search}`,
                  }),
                )
              }
            >
              {pending === 'google' ? 'Opening Google…' : 'Continue with Google'}
            </button>
          </div>
          {passkeyButton && (
            <>
              <div className="auth-divider" aria-hidden="true">
                <span>or</span>
              </div>
              <div className="auth-methods">{passkeyButton}</div>
            </>
          )}
          {errorAlert}
        </section>
      </main>
    );
  }

  return (
    <main className="auth-screen signin-screen">
      <section className="auth-card">
        <h1>Sign in</h1>
        <form className="signin-form" onSubmit={(event) => void sendMagicLink(event)}>
          <label>
            <span>Email</span>
            <input
              autoComplete="email webauthn"
              className="auth-field"
              required
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </label>
          <button className="auth-primary" disabled={pending !== null} type="submit">
            {pending === 'magic-link' ? 'Sending…' : 'Send sign-in link'}
          </button>
        </form>
        {passkeyButton && (
          <>
            <div className="auth-divider" aria-hidden="true">
              <span>or</span>
            </div>
            <div className="auth-methods">{passkeyButton}</div>
          </>
        )}
        {errorAlert}
      </section>
    </main>
  );
}

function methodLabel(method: Method): string {
  if (method === 'magic-link') return 'email';
  return method;
}
