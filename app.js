const config = window.HELPDESK_PORTAL_CONFIG || {};
const form = document.querySelector('#request-form');
const submitButton = document.querySelector('#submit-button');
const formNotice = document.querySelector('#form-notice');
const verificationForm = document.querySelector('#verification-form');
const verificationEmail = document.querySelector('#verification-email');
const verificationButton = document.querySelector('#verification-button');
const verificationNotice = document.querySelector('#verification-notice');
const verificationCard = document.querySelector('#verification-card');
const requestCard = document.querySelector('#request-card');
const verifiedEmail = document.querySelector('#verified-email');
const requesterLine = document.querySelector('#requester-line');
const switchEmailButton = document.querySelector('#switch-email-button');
const firebaseApp = window.firebase && config.firebase
  ? (window.firebase.apps.length
    ? window.firebase.app()
    : window.firebase.initializeApp(config.firebase))
  : null;
const auth = firebaseApp ? firebaseApp.auth() : null;
const firestore = firebaseApp ? firebaseApp.firestore() : null;
const ticketCollection = config.ticketCollection || 'tickets';

function showNotice(element, message, kind = 'error') {
  element.textContent = message;
  element.className = `notice ${kind}`;
}

function clearNotice(element) {
  element.textContent = '';
  element.className = 'notice';
}

function normalizeEmail(email) {
  return email.trim().toLowerCase();
}

function generateTicketId() {
  const value = new Uint32Array(1);
  window.crypto.getRandomValues(value);
  return String(1000000 + (value[0] % 9000000));
}

function createVerificationLinkSettings() {
  return {
    url: window.location.href.split('?')[0].split('#')[0],
    handleCodeInApp: true
  };
}

async function sendVerificationLink(email) {
  await auth.sendSignInLinkToEmail(email, createVerificationLinkSettings());
  window.localStorage.setItem('joe-e-verification-email', email);
  showNotice(
    verificationNotice,
    `A secure sign-in link was sent to ${email}. Open that email on this device to verify and continue.`,
    'success'
  );
}

async function finishEmailLinkSignIn() {
  if (!auth || !auth.isSignInWithEmailLink(window.location.href)) return false;
  const email = window.localStorage.getItem('joe-e-verification-email');
  if (!email) {
    showNotice(
      verificationNotice,
      'For security, open the sign-in link on the same device where you requested it, then request a new link if needed.'
    );
    return true;
  }

  try {
    const credential = await auth.signInWithEmailLink(email, window.location.href);
    const token = await credential.user.getIdTokenResult(true);
    if (token.claims.email_verified !== true) {
      await auth.signOut();
      throw new Error('Firebase has not verified this email yet. Request a new sign-in link and try again.');
    }
    window.localStorage.removeItem('joe-e-verification-email');
    window.history.replaceState({}, '', window.location.pathname);
    return true;
  } catch (error) {
    showNotice(verificationNotice, error.message || 'The sign-in link could not be verified. Request a new one.');
    return true;
  }
}

function showVerifiedForm(user) {
  if (!user.email || !user.emailVerified) {
    throw new Error('A verified email address is required.');
  }

  const email = normalizeEmail(user.email);
  verificationCard.classList.add('hidden');
  requestCard.classList.remove('hidden');
  verifiedEmail.textContent = `Verified as ${email}`;
  requesterLine.value = email;
  clearNotice(verificationNotice);
  clearNotice(formNotice);
  submitButton.disabled = false;
}

async function restoreSession() {
  if (!auth) {
    showNotice(verificationNotice, 'Firebase Authentication is not configured for this portal.');
    verificationButton.disabled = true;
    return;
  }
  await finishEmailLinkSignIn();
  auth.onAuthStateChanged(async (user) => {
    if (!user) {
      requestCard.classList.add('hidden');
      verificationCard.classList.remove('hidden');
      return;
    }
    try {
      await user.reload();
      if (!user.emailVerified) {
        await auth.signOut();
        return;
      }
      showVerifiedForm(user);
    } catch (error) {
      showNotice(formNotice, error.message);
    }
  });
}

verificationForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  clearNotice(verificationNotice);
  verificationButton.disabled = true;
  try {
    await sendVerificationLink(normalizeEmail(verificationEmail.value));
  } catch (error) {
    showNotice(verificationNotice, error.message || 'Could not send the sign-in link.');
  } finally {
    verificationButton.disabled = false;
  }
});

switchEmailButton.addEventListener('click', async () => {
  if (auth) await auth.signOut();
  form.reset();
  requestCard.classList.add('hidden');
  verificationCard.classList.remove('hidden');
  verificationEmail.value = '';
  verificationEmail.focus();
});

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  clearNotice(formNotice);
  submitButton.disabled = true;

  try {
    const user = auth.currentUser;
    if (!user) throw new Error('Sign in with your verified email before submitting.');
    await user.reload();
    if (!user.emailVerified) throw new Error('Verify your email before submitting.');

    const data = Object.fromEntries(new FormData(form).entries());
    const publicData = {
      ticketType: 'joe_e',
      requesterName: normalizeEmail(user.email),
      providerName: data.providerName.trim(),
      userType: data.userType,
      newUserFullName: data.newUserFullName.trim(),
      newUserEmail: normalizeEmail(data.newUserEmail),
      npi: data.npi.trim()
    };
    const description = [
      'Joe-E access request',
      `Requester: ${publicData.requesterName}`,
      `Provider: ${publicData.providerName}`,
      `User type: ${publicData.userType}`,
      `New user: ${publicData.newUserFullName} <${publicData.newUserEmail}>`,
      `NPI: ${publicData.npi || 'Not provided'}`
    ].join('\n');
    const now = new Date().toISOString();
    const ticketRef = firestore.collection(ticketCollection).doc(generateTicketId());
    const ticket = {
      id: ticketRef.id,
      requesterEmail: normalizeEmail(user.email),
      subject: data.subject.trim(),
      description,
      category: 'access',
      ticketType: 'joe_e',
      intakeSource: 'github_pages',
      onboardingData: null,
      publicData,
      status: 'new',
      priority: 'normal',
      attachments: [],
      createdAt: now,
      updatedAt: now
    };
    await ticketRef.set(ticket);
    form.reset();
    showNotice(formNotice, `Your Joe-E access request was submitted. Ticket number: #${ticketRef.id}.`, 'success');
  } catch (error) {
    showNotice(formNotice, error.message || 'The request could not be submitted.');
  } finally {
    submitButton.disabled = false;
  }
});

restoreSession();
