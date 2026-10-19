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
const submissionDialog = document.querySelector('#submission-dialog');
const submissionCloseButton = document.querySelector('#submission-close-button');
const subjectInput = document.querySelector('#subject');
const categorySelect = document.querySelector('#category');
const descriptionInput = document.querySelector('#description');
const firebaseApp = window.firebase && config.firebase
  ? (window.firebase.apps.length
    ? window.firebase.app()
    : window.firebase.initializeApp(config.firebase))
  : null;
const auth = firebaseApp ? firebaseApp.auth() : null;
const firestore = firebaseApp ? firebaseApp.firestore() : null;
const ticketCollection = config.ticketCollection || 'tickets';
const VERIFICATION_EMAIL_KEY = 'ticket-verification-email';

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

function showSubmissionConfirmation(ticketId) {
  document.querySelector('#submitted-ticket-number').textContent = `#${ticketId}`;
  submissionDialog.showModal();
}

function createVerificationLinkSettings() {
  return {
    url: window.location.href.split('?')[0].split('#')[0],
    handleCodeInApp: true
  };
}

async function sendVerificationLink(email) {
  await auth.sendSignInLinkToEmail(email, createVerificationLinkSettings());
  window.localStorage.setItem(VERIFICATION_EMAIL_KEY, email);
  showNotice(
    verificationNotice,
    `A secure sign-in link was sent to ${email}. Open that email on this device to verify and continue.`,
    'success'
  );
}

async function finishEmailLinkSignIn() {
  if (!auth || !auth.isSignInWithEmailLink(window.location.href)) return false;
  const email = window.localStorage.getItem(VERIFICATION_EMAIL_KEY);
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
    window.localStorage.removeItem(VERIFICATION_EMAIL_KEY);
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

    const requesterEmail = normalizeEmail(user.email);
    const subject = subjectInput.value.trim();
    const category = categorySelect.value;
    const description = descriptionInput.value.trim();
    const now = new Date().toISOString();
    const sequenceRef = firestore.collection('helpdeskMetadata').doc('ticketSequence');
    const ticketId = await firestore.runTransaction(async (transaction) => {
      const sequenceSnapshot = await transaction.get(sequenceRef);
      const nextId = (sequenceSnapshot.exists ? sequenceSnapshot.data().value : 0) + 1;
      const ticketRef = firestore.collection(ticketCollection).doc(String(nextId));
      const ticket = {
        id: String(nextId),
        requesterEmail,
        subject,
        description,
        category,
        ticketType: 'general',
        intakeSource: 'github_pages',
        onboardingData: null,
        publicData: null,
        status: 'new',
        priority: 'normal',
        attachments: [],
        createdAt: now,
        updatedAt: now
      };
      transaction.set(sequenceRef, { value: nextId });
      transaction.set(ticketRef, ticket);
      return nextId;
    });
    form.reset();
    showSubmissionConfirmation(ticketId);
  } catch (error) {
    showNotice(formNotice, error.message || 'The ticket could not be submitted.');
  } finally {
    submitButton.disabled = false;
  }
});

submissionCloseButton.addEventListener('click', () => {
  submissionDialog.close();
});

restoreSession();
