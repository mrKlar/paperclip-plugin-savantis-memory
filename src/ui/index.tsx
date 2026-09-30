import { useEffect, useRef, useState } from 'react';
import { usePluginAction, usePluginData, type PluginPageProps } from '@paperclipai/plugin-sdk/ui';

export function SavantisMemoryPage({ context }: PluginPageProps) {
  const companyId = context.companyId || sessionStorage.getItem('paperclip-savantis-company') || undefined;
  const { data, loading, error, refresh } = usePluginData<{ connected: boolean }>('connection-status', { companyId });
  const start = usePluginAction('start-oauth');
  const finish = usePluginAction('finish-oauth');
  const handled = useRef(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const code = params.get('code'), state = params.get('state');
    if ((!code && !params.has('error')) || handled.current) return;
    handled.current = true;
    history.replaceState(null, '', location.pathname);
    if (!code || !state || !companyId) {
      setMessage('Connexion interrompue. Vous pouvez la relancer.');
      return;
    }
    setBusy(true);
    finish({ companyId, code, state }).then(() => {
      setMessage('Savantis est connecté.');
      refresh();
    }).catch(() => setMessage('La connexion a échoué. Relancez la connexion à Savantis.'))
      .finally(() => setBusy(false));
  }, [companyId, finish, refresh]);

  async function connect() {
    if (!companyId) return;
    setBusy(true);
    setMessage('');
    try {
      sessionStorage.setItem('paperclip-savantis-company', companyId);
      const result = await start({ companyId }) as { authorizationUrl: string };
      const url = new URL(result.authorizationUrl);
      if (url.origin !== 'https://context.savantisai.com') throw new Error('Unexpected authorization server');
      location.assign(url.toString());
    } catch {
      setMessage('Impossible de démarrer la connexion. Vérifiez la configuration du plugin.');
      setBusy(false);
    }
  }

  return <section style={{ maxWidth: 720, padding: 24 }} aria-label="Savantis Memory">
    <h1 style={{ fontSize: 24, fontWeight: 600, marginBottom: 12 }}>Savantis Memory</h1>
    <p>Mémoire permanente des agents Paperclip.</p>
    <p role="status" style={{ margin: '20px 0' }}>
      {busy ? 'Connexion en cours…' : loading ? 'Vérification…' : error ? 'État indisponible' : data?.connected ? 'Connecté à Savantis' : 'Savantis n’est pas connecté'}
    </p>
    <button onClick={connect} disabled={busy || !companyId} style={{ border: '1px solid currentColor', borderRadius: 6, padding: '8px 16px', cursor: 'pointer' }}>
      {data?.connected ? 'Reconnecter Savantis' : 'Connecter Savantis'}
    </button>
    {!companyId && <p>Sélectionnez l’entreprise Paperclip pour configurer sa mémoire.</p>}
    {message && <p role="status" style={{ marginTop: 16 }}>{message}</p>}
    <p style={{ marginTop: 24 }}>Les agents peuvent rappeler le contexte utile et conserver les décisions durables dans l’espace Paperclip, selon votre politique mémoire.</p>
    <p>Ne transmettez aucun secret à la mémoire. Votre agent doit obtenir votre accord avant de conserver des informations sensibles.</p>
  </section>;
}

export const SavantisMemorySettings = SavantisMemoryPage;
