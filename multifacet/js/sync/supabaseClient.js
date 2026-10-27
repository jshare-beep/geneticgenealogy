// Cloud save + sign-in via Supabase, reached directly from the browser through its CDN
// ESM client - no bundler needed. Gracefully falls back to "not configured" (callers
// should fall back to local-only save) until supabase/config.js exists with real
// project credentials - see supabase/config.example.js for setup.
//
// Auth model: Google OAuth or magic-link email sign-in (no passwords). An account can
// own any number of named tree rows; RLS on the `trees` table restricts every
// read/write/delete to `auth.uid() = user_id`, so the anon key shipped to the browser
// can't touch anyone else's data - see supabase/schema.sql.

let clientPromise = null;

async function getClient() {
  if (clientPromise) return clientPromise;
  clientPromise = (async () => {
    let config;
    try {
      config = await import('../../../supabase/config.js');
    } catch {
      return null;
    }
    if (!config.SUPABASE_URL || config.SUPABASE_URL.includes('YOUR-PROJECT')) return null;
    const { createClient } = await import('https://esm.sh/@supabase/supabase-js@2');
    return createClient(config.SUPABASE_URL, config.SUPABASE_ANON_KEY);
  })();
  return clientPromise;
}

export async function isCloudConfigured() {
  return (await getClient()) !== null;
}

export async function getSession() {
  const client = await getClient();
  if (!client) return null;
  const { data } = await client.auth.getSession();
  return data.session;
}

export async function onAuthChange(callback) {
  const client = await getClient();
  if (!client) return () => {};
  const { data } = client.auth.onAuthStateChange((_event, session) => callback(session));
  return () => data.subscription.unsubscribe();
}

export async function signInWithEmail(email) {
  const client = await getClient();
  if (!client) throw new Error('Cloud sign-in is not configured yet.');
  const { error } = await client.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: window.location.href },
  });
  if (error) throw error;
}

export async function signInWithGoogle() {
  const client = await getClient();
  if (!client) throw new Error('Cloud sign-in is not configured yet.');
  const { error } = await client.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: window.location.href },
  });
  if (error) throw error;
}

export async function signOut() {
  const client = await getClient();
  if (!client) return;
  await client.auth.signOut();
}

export async function listMyTrees() {
  const client = await getClient();
  if (!client) throw new Error('Cloud sync is not configured yet.');
  const { data, error } = await client.from('trees').select('id, name, updated_at').order('updated_at', { ascending: false });
  if (error) throw error;
  return (data || []).map((row) => ({ id: row.id, name: row.name, updatedAt: row.updated_at }));
}

export async function loadTree(id) {
  const client = await getClient();
  if (!client) throw new Error('Cloud sync is not configured yet.');
  const { data, error } = await client.from('trees').select('data').eq('id', id).single();
  if (error) throw error;
  return data.data;
}

export async function createTree(userId, name, treeData) {
  const client = await getClient();
  if (!client) throw new Error('Cloud sync is not configured yet.');
  const { data, error } = await client
    .from('trees')
    .insert({ user_id: userId, name, data: treeData })
    .select('id')
    .single();
  if (error) throw error;
  return data.id;
}

export async function updateTree(id, name, treeData) {
  const client = await getClient();
  if (!client) throw new Error('Cloud sync is not configured yet.');
  const { error } = await client
    .from('trees')
    .update({ name, data: treeData, updated_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throw error;
}

export async function deleteTree(id) {
  const client = await getClient();
  if (!client) throw new Error('Cloud sync is not configured yet.');
  const { error } = await client.from('trees').delete().eq('id', id);
  if (error) throw error;
}
