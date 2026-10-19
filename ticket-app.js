const config = window.HELPDESK_PORTAL_CONFIG || {};
const form = document.querySelector('#request-form');
const submitButton = document.querySelector('#submit-button');
const formNotice = document.querySelector('#form-notice');
const requesterEmailInput = document.querySelector('#requester-email');
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
const firestore = firebaseApp ? firebaseApp.firestore() : null;
const ticketCollection = config.ticketCollection || 'tickets';
const ALLOWED_EMAIL_DOMAINS = ['pivotalstjoe.org', 'stjoecmh.org'];
const SAVED_EMAIL_KEY = 'ticket-requester-email';

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

function isAllowedDomain(email) {
  const domain = email.split('@')[1] || '';
  return ALLOWED_EMAIL_DOMAINS.includes(domain);
}

function restoreSavedEmail() {
  try {
    const savedEmail = window.localStorage.getItem(SAVED_EMAIL_KEY);
    if (savedEmail) requesterEmailInput.value = savedEmail;
  } catch (error) {
    // localStorage unavailable; nothing to restore.
  }
}

function saveEmail(email) {
  try {
    window.localStorage.setItem(SAVED_EMAIL_KEY, email);
  } catch (error) {
    // localStorage unavailable; skip saving.
  }
}

function showSubmissionConfirmation(ticketId) {
  document.querySelector('#submitted-ticket-number').textContent = `#${ticketId}`;
  submissionDialog.showModal();
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  clearNotice(formNotice);
  submitButton.disabled = true;

  try {
    const requesterEmail = normalizeEmail(requesterEmailInput.value);
    if (!isAllowedDomain(requesterEmail)) {
      throw new Error(`Email must end in ${ALLOWED_EMAIL_DOMAINS.map((domain) => `@${domain}`).join(' or ')}.`);
    }

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
    saveEmail(requesterEmail);
    form.reset();
    requesterEmailInput.value = requesterEmail;
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

restoreSavedEmail();
