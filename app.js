const config = window.HELPDESK_PORTAL_CONFIG || {};
const form = document.querySelector('#request-form');
const requesterSearch = document.querySelector('#requester-search');
const requesterOptions = document.querySelector('#requester-options');
const companySelect = document.querySelector('#company');
const submitButton = document.querySelector('#submit-button');
const formNotice = document.querySelector('#form-notice');
const verificationForm = document.querySelector('#verification-form');
const verificationEmail = document.querySelector('#verification-email');
const verificationButton = document.querySelector('#verification-button');
const verificationNotice = document.querySelector('#verification-notice');
const verificationCard = document.querySelector('#verification-card');
const requestCard = document.querySelector('#request-card');
const verifiedEmail = document.querySelector('#verified-email');
const switchEmailButton = document.querySelector('#switch-email-button');
const firebaseApp = window.firebase && config.firebase
  ? (window.firebase.apps.length
    ? window.firebase.app()
    : window.firebase.initializeApp(config.firebase))
  : null;
const auth = firebaseApp ? firebaseApp.auth() : null;
const firestore = firebaseApp ? firebaseApp.firestore() : null;
const ticketCollection = config.ticketCollection || 'tickets';
let requesters = [];
let approvedRequester = null;
let directoryLoaded = false;

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

async function loadDirectory(email) {
  const [requesterSnapshot, companySnapshot] = await Promise.all([
    firestore.collection('publicRequesters')
      .where('active', '==', true)
      .where('email', '==', email)
      .get(),
    firestore.collection('publicCompanies')
      .where('active', '==', true)
      .get()
  ]);

  requesters = requesterSnapshot.docs.map((document) => ({
    id: document.id,
    ...document.data()
  }));
  approvedRequester = requesters.find((requester) => normalizeEmail(requester.email || '') === email) || null;

  requesterOptions.replaceChildren();
  if (approvedRequester) {
    const option = document.createElement('option');
    option.value = approvedRequester.name;
    requesterOptions.append(option);
    requesterSearch.value = approvedRequester.name;
    requesterSearch.readOnly = true;
  } else {
    requesterSearch.value = '';
    requesterSearch.readOnly = false;
    for (const requester of requesters) {
      const option = document.createElement('option');
      option.value = requester.name;
      requesterOptions.append(option);
    }
  }

  companySelect.replaceChildren(new Option('Select company', ''));
  for (const document of companySnapshot.docs) {
    const company = document.data();
    companySelect.add(new Option(company.name, document.id));
  }
  if (companySelect.options.length === 1) {
    throw new Error('No approved companies are available. Please contact the IT team.');
  }
  directoryLoaded = true;
}

async function showVerifiedForm(user) {
  if (!user.email || !user.emailVerified) {
    throw new Error('A verified email address is required.');
  }

  const email = normalizeEmail(user.email);
  verificationCard.classList.add('hidden');
  requestCard.classList.remove('hidden');
  verifiedEmail.textContent = `Verified as ${email}`;
  clearNotice(verificationNotice);
  clearNotice(formNotice);
  submitButton.disabled = true;
  directoryLoaded = false;

  try {
    await loadDirectory(email);
    if (!approvedRequester) {
      requesterSearch.readOnly = false;
      showNotice(
        formNotice,
        'This verified email is not on the approved requester list. Contact the IT team to request access.'
      );
      return;
    }
    submitButton.disabled = false;
  } catch (error) {
    showNotice(formNotice, error.message);
  }
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
      await showVerifiedForm(user);
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
  requesterSearch.readOnly = false;
  requesterOptions.replaceChildren();
  companySelect.replaceChildren(new Option('Sign in to load approved companies', ''));
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
    if (!directoryLoaded || !approvedRequester) {
      throw new Error('Your email is not on the approved requester list.');
    }

    const companyId = companySelect.value;
    const companySnapshot = await firestore.collection('publicCompanies').doc(companyId).get();
    if (!companySnapshot.exists || companySnapshot.data().active !== true) {
      throw new Error('Select an active company from the approved list.');
    }
    const company = companySnapshot.data();
    const data = Object.fromEntries(new FormData(form).entries());
    const selectedRequester = requesterSearch.value.trim() === approvedRequester.name
      ? approvedRequester
      : requesters.find((requester) => requester.name === requesterSearch.value.trim());
    if (!selectedRequester || normalizeEmail(selectedRequester.email || '') !== normalizeEmail(user.email)) {
      throw new Error('Select your own name from the approved requester list.');
    }
    const publicData = {
      ticketType: 'joe_e',
      requesterId: selectedRequester.id,
      requesterName: selectedRequester.name,
      providerName: data.providerName.trim(),
      userType: data.userType,
      newUserFullName: data.newUserFullName.trim(),
      newUserEmail: normalizeEmail(data.newUserEmail),
      npi: data.npi.trim(),
      companyId,
      companyName: company.name
    };
    const description = [
      'Joe-E access request',
      `Requester: ${publicData.requesterName}`,
      `Provider: ${publicData.providerName}`,
      `User type: ${publicData.userType}`,
      `New user: ${publicData.newUserFullName} <${publicData.newUserEmail}>`,
      `NPI: ${publicData.npi || 'Not provided'}`,
      `Company: ${publicData.companyName}`
    ].join('\n');
    const now = new Date().toISOString();
    const ticketRef = firestore.collection(ticketCollection).doc();
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
    requesterSearch.value = approvedRequester.name;
    showNotice(formNotice, `Your Joe-E access request was submitted. Ticket number: #${ticketRef.id}.`, 'success');
  } catch (error) {
    showNotice(formNotice, error.message || 'The request could not be submitted.');
  } finally {
    submitButton.disabled = !directoryLoaded || !approvedRequester;
  }
});

restoreSession();
