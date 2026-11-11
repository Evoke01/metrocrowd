// ══════════════════════════════════════════════════════════════════
//  AUTH MODULE — Google & GitHub OAuth via Supabase
//  Handles: sign-in, sign-out, session restore, profile display,
//           anonymous→signed-in report migration, avatar, modal UI
// ══════════════════════════════════════════════════════════════════
window.AUTH = (function(){

  let currentUser = null;   // Supabase User object
  let client      = null;   // Supabase client (set by init)
  let reportCount = 0;

  // ── Login gate ─────────────────────────────────────────────────
  const GUEST_KEY = 'mc_guest';
  function _isGuest(){ try{ return localStorage.getItem(GUEST_KEY) === '1'; }catch(_){ return false; } }

  // Guests can browse the whole app; signing in is only needed for
  // syncing, rewards and alerts.
  function showGate(force){
    if(!force && _isGuest()){ hideGate(); return; }
    const g=document.getElementById('login-gate');
    if(g){ g.style.display='flex'; g.style.opacity='1'; }
    const app=document.getElementById('app');
    if(app) app.style.visibility='hidden';
  }

  function hideGate(){
    const g=document.getElementById('login-gate');
    if(g && g.style.display!=='none'){ g.style.transition='opacity .35s'; g.style.opacity='0'; setTimeout(()=>{ g.style.display='none'; },350); }
    const app=document.getElementById('app');
    if(app){ app.style.visibility='visible'; }
  }

  function continueAsGuest(){
    try{ localStorage.setItem(GUEST_KEY,'1'); }catch(_){}
    hideGate();
  }

  // From inside the app: bring the sign-in screen back.
  function showSignIn(){
    closeModal();
    showGate(true);
  }

  // ── Bootstrap (called by SB.init after client is ready) ────────
  function init(sbClient){
    client = sbClient;

    // Listen for every auth state change: sign-in, sign-out, token refresh
    client.auth.onAuthStateChange(async (event, session) => {
      console.log('[AUTH] event:', event, session?.user?.email || session?.user?.id?.slice(0,8));

      // The app creates an anonymous Supabase session for public writes. It
      // must not be treated as a completed OAuth sign-in or dismiss the gate.
      if(session?.user?.is_anonymous){
        currentUser = null;
        showGate();
        return;
      }

      if(event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED' || event === 'USER_UPDATED'){
        currentUser = session.user;
        hideGate();
        await onSignedIn(session.user, event);
      }
      else if(event === 'SIGNED_OUT'){
        currentUser = null;
        onSignedOut();
      }
    });

    // Restore existing session on page load
    client.auth.getSession().then(async ({ data: { session } }) => {
      const u = session?.user;
      if(u && !u.is_anonymous && u.email){
        // Valid real session found — refresh token silently
        try{ await client.auth.refreshSession(); }catch(_){}
        currentUser = u;
        hideGate();
        onSignedIn(u, 'RESTORED');
      } else {
        // No valid session or anonymous — show login gate
        showGate();
      }
    });
  }

  // ── Triggered whenever user is confirmed signed-in ─────────────
  async function onSignedIn(user, event){

    updateButtonUI(user);
    closeModal();
    hideLoading();

    // If user just signed in (not a restore), show welcome toast
    if(event === 'SIGNED_IN'){
      const name = displayName(user);
      SB.showToast(`Welcome${name ? ', '+name : ''}! Reports now sync across devices.`);
    }

    // Load report count for profile
    reportCount = await fetchReportCount(user.id);
    updateProfileUI(user, reportCount);
    if(typeof REWARDS !== 'undefined') REWARDS.onSignedIn().catch(e => console.warn('[AUTH] rewards init failed:', e));
  }

  function onSignedOut(){
    updateButtonUI(null);
    updateProfileUI(null, 0);
    showSignedOutView();
    closeModal();
    showGate(true);
  }

  // ── OAuth sign-in ───────────────────────────────────────────────
  async function signInGoogle(){
    if(!client){ SB.showToast('Supabase not configured yet.'); return; }
    showLoading('Redirecting to Google…');
    const lg=document.getElementById('lg-loading');if(lg)lg.style.display='block';
    const lgm=document.getElementById('lg-loading-msg');if(lgm)lgm.textContent='Redirecting to Google…';
    document.getElementById('lg-google')&&(document.getElementById('lg-google').style.opacity='.5');
    document.getElementById('lg-github')&&(document.getElementById('lg-github').style.opacity='.5');
    try{
      const { error } = await client.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: (location.hostname === 'localhost' ? 'https://metrocrowd.vercel.app' : location.origin),
          queryParams: { access_type: 'offline', prompt: 'consent' },
          skipBrowserRedirect: false,
        }
      });
      if(error) throw error;
      // Page redirects — loading state stays until return
    }catch(err){
      hideLoading();
      SB.showToast('Google sign-in failed: '+err.message);
      console.error('[AUTH] Google:', err);
    }
  }

  async function signInGitHub(){
    if(!client){ SB.showToast('Supabase not configured yet.'); return; }
    showLoading('Redirecting to GitHub…');
    const lg2=document.getElementById('lg-loading');if(lg2)lg2.style.display='block';
    const lgm2=document.getElementById('lg-loading-msg');if(lgm2)lgm2.textContent='Redirecting to GitHub…';
    document.getElementById('lg-google')&&(document.getElementById('lg-google').style.opacity='.5');
    document.getElementById('lg-github')&&(document.getElementById('lg-github').style.opacity='.5');
    try{
      const { error } = await client.auth.signInWithOAuth({
        provider: 'github',
        options: {
          redirectTo: (location.hostname === 'localhost' ? 'https://metrocrowd.vercel.app' : location.origin),
          skipBrowserRedirect: false,
        }
      });
      if(error) throw error;
    }catch(err){
      hideLoading();
      SB.showToast('GitHub sign-in failed: '+err.message);
      console.error('[AUTH] GitHub:', err);
    }
  }

  async function deleteAccount(){
    const confirmed = window.confirm(
      'Delete your account and all data?\n\n' +
      '• Your saved routes and preferences will be deleted\n' +
      '• Your crowd reports will be anonymised (not deleted)\n' +
      '• This cannot be undone\n\n' +
      'Tap OK to confirm.'
    );
    if(!confirmed) return;

    showLoading('Deleting account…');
    try{
      // 1. Delete saved_routes and push_tokens (RLS ensures own rows only)
      if(client && currentUser){
        await client.from('saved_routes').delete().eq('user_id', currentUser.id);
        await client.from('push_tokens').delete().eq('user_id', currentUser.id);
        // Anonymise crowd reports (set user_id to null)
        await client.from('crowd_reports')
          .update({ user_id: null })
          .eq('user_id', currentUser.id);
      }
      // 2. Sign out and clear local state
      localStorage.clear();
      sessionStorage.clear();
      await client.auth.signOut();
      hideLoading();
      // Reload to login gate
      window.location.reload();
    }catch(err){
      hideLoading();
      SB.showToast('Delete failed: '+err.message);
      console.error('[AUTH] deleteAccount:', err);
    }
  }


  async function signOut(){
    if(!client) return;
    showLoading('Signing out…');
    await client.auth.signOut();
    hideLoading();
    closeModal();
  }





  // ── Fetch how many reports this user has submitted ─────────────
  async function fetchReportCount(userId){
    if(!client||!userId) return 0;
    try{
      // Read from profiles.karma — auto-incremented by DB trigger on every report insert
      const { data, error } = await client
        .from('profiles')
        .select('karma')
        .eq('id', userId)
        .single();
      if(error) throw error;
      const karma = data?.karma || 0;
      // Keep local karma in sync with DB
      localStorage.setItem('v3_karma', karma);
      return karma;
    }catch(e){
      console.warn('[AUTH] fetchReportCount error:', e.message);
      // Fallback: count directly from crowd_reports
      try{
        const { count } = await client
          .from('crowd_reports')
          .select('*', { count:'exact', head:true })
          .eq('user_id', userId);
        if(count > 0) localStorage.setItem('v3_karma', count);
        return count || 0;
      }catch{
        return parseInt(localStorage.getItem('v3_karma') || '0', 10);
      }
    }
  }

  // ── Update the small avatar button in the data-bar ─────────────
  function updateButtonUI(user){
    const btn   = document.getElementById('auth-btn');
    const avatar= document.getElementById('auth-avatar');
    const label = document.getElementById('auth-label');
    if(!btn) return;

    if(user){
      const avatarUrl = user.user_metadata?.avatar_url;
      const name      = displayName(user);
      const provider  = (user.app_metadata?.provider||'').toLowerCase();

      if(avatarUrl){
        avatar.innerHTML = `<img src="${avatarUrl}" style="width:100%;height:100%;object-fit:cover;border-radius:50%">`;
      } else {
        avatar.textContent = name ? name[0].toUpperCase() : '?';
        avatar.style.background = strColor(user.id);
        avatar.style.color = '#fff';
        avatar.style.fontFamily = "'JetBrains Mono',monospace";
        avatar.style.fontSize = '10px';
        avatar.style.fontWeight = '700';
      }
      label.textContent = name || 'Signed in';
      label.style.color = 'var(--low)';
      btn.style.borderColor = 'rgba(0,230,118,.35)';
      btn.title = `Signed in via ${provider}`;
    } else {
      avatar.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>';
      avatar.style.background = 'var(--border)';
      label.textContent = 'Sign in';
      label.style.color = 'var(--muted)';
      btn.style.borderColor = 'var(--border)';
      btn.title = 'Sign in';
    }
  }

  // ── Update the profile panel inside the modal ──────────────────
  function updateProfileUI(user, reports){
    if(!user){
      showSignedOutView();
      return;
    }

    const name      = displayName(user);
    const email     = user.email || '';
    const avatarUrl = user.user_metadata?.avatar_url || '';
    const provider  = (user.app_metadata?.provider||'email').toLowerCase();
    const provLabel = provider==='google' ? 'Google' : provider==='github' ? 'GitHub' : 'Email';
    const since = user.created_at
      ? new Date(user.created_at).toLocaleDateString('en-IN',{month:'short',year:'numeric'})
      : '—';

    _s('auth-user-name',  name||'User');
    _s('auth-user-email', email);
    _s('auth-user-provider', provLabel);
    _s('auth-stat-reports', String(reports));
    _s('karma-num', String(reports));
    _s('rs-karma', String(reports));
    _s('auth-stat-session', since);

    const img = document.getElementById('auth-user-avatar');
    if(img){
      if(avatarUrl){ img.src=avatarUrl; img.style.display='block'; }
      else{ img.style.display='none'; }
    }

    // Switch to signed-in view
    document.getElementById('auth-signout-view').style.display = 'none';
    document.getElementById('auth-signin-view').style.display  = 'block';
    document.getElementById('auth-loading-view').style.display = 'none';
  }

  function showSignedOutView(){
    document.getElementById('auth-signout-view').style.display = 'block';
    document.getElementById('auth-signin-view').style.display  = 'none';
    document.getElementById('auth-loading-view').style.display = 'none';
  }

  // ── Modal open / close ─────────────────────────────────────────
  function openModal(){
    const modal = document.getElementById('auth-modal');
    if(!modal) return;
    modal.style.display = 'flex';
    // Show correct inner view
    if(currentUser){
      updateProfileUI(currentUser, reportCount);
      // Refresh count from DB every time modal opens (keeps it live)
      fetchReportCount(currentUser.id).then(count => {
        reportCount = count;
        _s('auth-stat-reports', String(count));
        _s('karma-num', String(count));
        _s('rs-karma', String(count));
      });
    } else {
      showSignedOutView();
    }
    requestAnimationFrame(()=>{ modal.classList.add('open'); });
  }

  function closeModal(){
    const modal = document.getElementById('auth-modal');
    if(!modal) return;
    modal.classList.remove('open');
    setTimeout(()=>{ modal.style.display='none'; }, 300);
  }

  // ── Loading overlay inside modal ───────────────────────────────
  function showLoading(msg){
    document.getElementById('auth-signout-view').style.display = 'none';
    document.getElementById('auth-signin-view').style.display  = 'none';
    document.getElementById('auth-loading-view').style.display = 'block';
    _s('auth-loading-msg', msg||'Please wait…');
  }

  function hideLoading(){
    document.getElementById('auth-loading-view').style.display = 'none';
  }

  // ── Supabase status bar helper (called by SB.init) ─────────────
  function setStatus(msg, type='info'){
    const el = document.getElementById('sb-status');
    if(!el) return;
    const c = {ok:'var(--low)',warn:'var(--a2)',error:'var(--pk)',info:'var(--muted)'};
    el.textContent = msg;
    el.style.color  = c[type]||c.info;
  }

  // ── Helpers ────────────────────────────────────────────────────
  function displayName(user){
    return user?.user_metadata?.full_name
        || user?.user_metadata?.name
        || user?.user_metadata?.user_name
        || user?.email?.split('@')[0]
        || null;
  }

  // Deterministic color from user id string
  function strColor(str){
    let h=0;for(const c of str)h=Math.imul(31,h)+c.charCodeAt(0)|0;
    return `hsl(${Math.abs(h)%360},60%,40%)`;
  }

  function _s(id, val){
    const el=document.getElementById(id); if(el) el.textContent=val;
  }

  // ── Public API ─────────────────────────────────────────────────
  return {
    init, openModal, closeModal,
    signInGoogle, signInGitHub, signOut, deleteAccount,
    showGate, hideGate, continueAsGuest, showSignIn,
    setStatus,
    get currentUser(){ return currentUser; },
    get isSignedIn(){ return !!currentUser; },
  };
})();
