/* ================= WebChat – reparierte, konsolidierte Version =================
   Firebase Auth + Firestore + Storage + einfache 1:1 WebRTC-Anrufe (Audio/Video)
================================================================================= */

import { initializeApp } from "https://www.gstatic.com/firebasejs/12.5.0/firebase-app.js";
import {
  getAuth, onAuthStateChanged, createUserWithEmailAndPassword,
  signInWithEmailAndPassword, signOut
} from "https://www.gstatic.com/firebasejs/12.5.0/firebase-auth.js";
import {
  getFirestore, doc, setDoc, updateDoc, collection, addDoc, getDocs,
  onSnapshot, query, where, orderBy
} from "https://www.gstatic.com/firebasejs/12.5.0/firebase-firestore.js";
import {
  getStorage, ref, uploadBytes, getDownloadURL
} from "https://www.gstatic.com/firebasejs/12.5.0/firebase-storage.js";

/* ================= Firebase ================= */
const firebaseConfig = {
  apiKey: "AIzaSyCFgiS9au7GOzhJ7_ayBcBM3bZrEm5GJOA",
  authDomain: "webchat-a47cc.firebaseapp.com",
  projectId: "webchat-a47cc",
  storageBucket: "webchat-a47cc.appspot.com",
  appId: "1:318380716143:web:da7474bfa392dfeaccdd9a"
};
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const storage = getStorage(app);

/* ================= DOM ================= */
const $ = id => document.getElementById(id);

const authArea = $("authArea"), userArea = $("userArea");
const tabLogin = $("tabLogin"), tabSignup = $("tabSignup");
const authForm = $("authForm"), authSubmitBtn = $("authSubmitBtn"), authError = $("authError");
const emailInput = $("email"), passwordInput = $("password");

const userInfo = $("userInfo"), userAvatar = $("userAvatar");
const profileBtn = $("profileBtn"), logoutBtn = $("logoutBtn");
const contactsDiv = $("contacts"), groupsDiv = $("groups");
const groupForm = $("groupForm"), newGroupName = $("newGroupName");

const sidebar = $("sidebar"), sidebarOpenBtn = $("sidebarOpenBtn"),
      sidebarCloseBtn = $("sidebarCloseBtn"), sidebarBackdrop = $("sidebarBackdrop");

const chatTitle = $("chatTitle"), chatBox = $("chatBox"), emptyHint = $("emptyHint");
const callButtons = $("callButtons"), audioCallBtn = $("audioCallBtn"),
      videoCallBtn = $("videoCallBtn"), endCallBtn = $("endCallBtn");
const videoGrid = $("videoGrid");

const messageForm = $("messageForm"), messageInput = $("messageInput"), sendBtn = $("sendBtn");
const imageInput = $("imageInput"), previewBar = $("previewBar"), previewImg = $("previewImg"),
      previewName = $("previewName"), previewCancel = $("previewCancel"), sendImageBtn = $("sendImageBtn");

const incomingPopup = $("incomingPopup"), popupCaller = $("popupCaller"), popupAvatar = $("popupAvatar"),
      acceptCallBtn = $("acceptCallBtn"), declineCallBtn = $("declineCallBtn");
const profilePopup = $("profilePopup"), profileAvatar = $("profileAvatar"),
      profileName = $("profileName"), profileEmail = $("profileEmail"), profileCloseBtn = $("profileCloseBtn");
const ringSound = $("ringSound");

/* ================= State ================= */
let me = null;
let selectedPeer = null;
let selectedFile = null;
let messagesUnsub = null;
let incomingCallsUnsub = null;
let activeListItem = null;

let pc = null;                 // aktive RTCPeerConnection
let localStream = null;
let currentCallId = null;
let currentCallRole = null;    // 'caller' | 'callee'
let callDocUnsub = null;
let iceUnsub = null;

const ICE_SERVERS = [{ urls: "stun:stun.l.google.com:19302" }];

/* ================= Helfer ================= */
function initials(name) {
  return (name || "?").trim().slice(0, 2).toUpperCase();
}
function fmtTime(ts) {
  if (!ts) return "";
  const d = new Date(ts);
  return d.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
}
function showError(msg) { authError.textContent = msg || ""; }

const AUTH_MESSAGES = {
  "auth/invalid-email": "Ungültige E-Mail-Adresse.",
  "auth/missing-password": "Bitte ein Passwort eingeben.",
  "auth/weak-password": "Das Passwort muss mindestens 6 Zeichen lang sein.",
  "auth/email-already-in-use": "Diese E-Mail-Adresse wird bereits verwendet.",
  "auth/invalid-credential": "E-Mail oder Passwort ist falsch.",
  "auth/wrong-password": "E-Mail oder Passwort ist falsch.",
  "auth/user-not-found": "Kein Konto mit dieser E-Mail-Adresse gefunden.",
  "auth/too-many-requests": "Zu viele Versuche. Bitte kurz warten."
};
function friendlyAuthError(e) {
  return AUTH_MESSAGES[e && e.code] || (e && e.message) || "Unbekannter Fehler.";
}

/* ================= Auth-Tabs ================= */
let authMode = "login";
function setAuthMode(mode) {
  authMode = mode;
  tabLogin.classList.toggle("active", mode === "login");
  tabSignup.classList.toggle("active", mode === "signup");
  authSubmitBtn.textContent = mode === "login" ? "Anmelden" : "Registrieren";
  passwordInput.autocomplete = mode === "login" ? "current-password" : "new-password";
  showError("");
}
tabLogin.onclick = () => setAuthMode("login");
tabSignup.onclick = () => setAuthMode("signup");

authForm.addEventListener("submit", async e => {
  e.preventDefault();
  showError("");
  const email = emailInput.value.trim();
  const pw = passwordInput.value;
  if (!email || !pw) return showError("Bitte E-Mail und Passwort ausfüllen.");
  authSubmitBtn.disabled = true;
  try {
    if (authMode === "login") {
      await signInWithEmailAndPassword(auth, email, pw);
    } else {
      await createUserWithEmailAndPassword(auth, email, pw);
    }
  } catch (err) {
    showError(friendlyAuthError(err));
  } finally {
    authSubmitBtn.disabled = false;
  }
});

logoutBtn.onclick = async () => {
  endCall();
  await signOut(auth);
};

/* ================= Sidebar (mobil) ================= */
function openSidebar() {
  sidebar.classList.add("open");
  sidebarBackdrop.classList.add("show");
}
function closeSidebar() {
  sidebar.classList.remove("open");
  sidebarBackdrop.classList.remove("show");
}
sidebarOpenBtn.onclick = openSidebar;
sidebarCloseBtn.onclick = closeSidebar;
sidebarBackdrop.onclick = closeSidebar;

/* ================= Profil ================= */
profileBtn.onclick = () => {
  if (!me) return;
  profileAvatar.textContent = initials(me.name);
  profileName.textContent = me.name;
  profileEmail.textContent = me.email || "";
  profilePopup.style.display = "flex";
};
profileCloseBtn.onclick = () => (profilePopup.style.display = "none");

/* ================= Auth-Status ================= */
onAuthStateChanged(auth, async user => {
  if (!user) {
    me = null;
    authArea.style.display = "block";
    userArea.style.display = "none";
    chatTitle.textContent = "Bitte anmelden";
    resetChatUI();
    if (messagesUnsub) { messagesUnsub(); messagesUnsub = null; }
    if (incomingCallsUnsub) { incomingCallsUnsub(); incomingCallsUnsub = null; }
    return;
  }

  me = { uid: user.uid, email: user.email, name: (user.email || "User").split("@")[0] };
  try {
    await setDoc(doc(db, "users", me.uid), me, { merge: true });
  } catch (err) {
    console.error("Konnte Nutzerprofil nicht speichern:", err);
  }

  authArea.style.display = "none";
  userArea.style.display = "block";
  userInfo.textContent = me.name;
  userAvatar.textContent = initials(me.name);
  chatTitle.textContent = "Wähle einen Chat";

  loadContacts();
  loadGroups();
  setupIncomingCallWatcher();
});

/* ================= Kontakte & Gruppen ================= */
async function loadContacts() {
  contactsDiv.innerHTML = "";
  try {
    const snap = await getDocs(collection(db, "users"));
    let count = 0;
    snap.forEach(d => {
      if (d.id === me.uid) return;
      count++;
      const u = d.data();
      contactsDiv.appendChild(
        buildListItem(u.name || u.email || "Nutzer", () =>
          selectChat({ type: "user", id: d.id, name: u.name || u.email || "Nutzer" })
        )
      );
    });
    if (!count) contactsDiv.innerHTML = '<p class="list-empty">Noch keine anderen Nutzer registriert.</p>';
  } catch (err) {
    console.error(err);
    contactsDiv.innerHTML = '<p class="list-empty">Kontakte konnten nicht geladen werden.</p>';
  }
}

async function loadGroups() {
  groupsDiv.innerHTML = "";
  try {
    const q = query(collection(db, "groups"), where("members", "array-contains", me.uid));
    const snap = await getDocs(q);
    let count = 0;
    snap.forEach(d => {
      count++;
      const g = d.data();
      groupsDiv.appendChild(
        buildListItem(g.name || "Gruppe", () => selectChat({ type: "group", id: d.id, name: g.name || "Gruppe" }),
          `${(g.members || []).length} Mitglieder`)
      );
    });
    if (!count) groupsDiv.innerHTML = '<p class="list-empty">Noch keine Gruppen.</p>';
  } catch (err) {
    console.error(err);
    groupsDiv.innerHTML = '<p class="list-empty">Gruppen konnten nicht geladen werden.</p>';
  }
}

function buildListItem(name, onClick, meta) {
  const div = document.createElement("div");
  div.className = "list-item";
  const avatar = document.createElement("div");
  avatar.className = "avatar";
  avatar.textContent = initials(name);
  const nameSpan = document.createElement("span");
  nameSpan.className = "list-item-name";
  nameSpan.textContent = name;
  div.appendChild(avatar);
  div.appendChild(nameSpan);
  if (meta) {
    const metaSpan = document.createElement("span");
    metaSpan.className = "list-item-meta";
    metaSpan.textContent = meta;
    div.appendChild(metaSpan);
  }
  div.onclick = () => {
    if (activeListItem) activeListItem.classList.remove("active");
    div.classList.add("active");
    activeListItem = div;
    onClick();
    closeSidebar();
  };
  return div;
}

groupForm.addEventListener("submit", async e => {
  e.preventDefault();
  const name = newGroupName.value.trim();
  if (!name || !me) return;
  try {
    await addDoc(collection(db, "groups"), { name, members: [me.uid], created: Date.now() });
    newGroupName.value = "";
    loadGroups();
  } catch (err) {
    alert("Gruppe konnte nicht erstellt werden: " + friendlyAuthError(err));
  }
});

/* ================= Chat ================= */
function resetChatUI() {
  selectedPeer = null;
  chatBox.innerHTML = "";
  chatBox.appendChild(emptyHint);
  emptyHint.style.display = "block";
  callButtons.style.display = "none";
  messageInput.disabled = true;
  sendBtn.disabled = true;
  hidePreview();
  endCall();
}

function selectChat(peer) {
  selectedPeer = peer;
  chatTitle.textContent = peer.name;
  chatBox.innerHTML = "";
  messageInput.disabled = false;
  sendBtn.disabled = false;
  callButtons.style.display = peer.type === "user" ? "flex" : "none";

  if (messagesUnsub) messagesUnsub();

  const q = peer.type === "group"
    ? query(collection(db, "messages"), where("to", "==", peer.id), orderBy("timestamp"))
    : query(collection(db, "messages"), orderBy("timestamp"));

  messagesUnsub = onSnapshot(q, snap => {
    chatBox.innerHTML = "";
    let any = false;
    snap.forEach(d => {
      const m = d.data();
      if (peer.type === "user") {
        if ((m.from === me.uid && m.to === peer.id) || (m.from === peer.id && m.to === me.uid)) {
          renderMessage(m, peer);
          any = true;
        }
      } else if (m.to === peer.id) {
        renderMessage(m, peer);
        any = true;
      }
    });
    if (!any) {
      chatBox.appendChild(emptyHint);
      emptyHint.style.display = "block";
      emptyHint.textContent = "Noch keine Nachrichten – schreib die erste!";
    }
    chatBox.scrollTop = chatBox.scrollHeight;
  }, err => console.error("Nachrichten konnten nicht geladen werden:", err));
}

function renderMessage(m, peer) {
  const isSent = m.from === me.uid;
  const row = document.createElement("div");
  row.className = "message-row " + (isSent ? "sent" : "received");

  if (!isSent && peer.type === "group") {
    const sender = document.createElement("div");
    sender.className = "message-sender";
    sender.textContent = m.fromName || "Nutzer";
    row.appendChild(sender);
  }

  if (m.type === "image") {
    const img = document.createElement("img");
    img.className = "message-img";
    img.src = m.url;
    img.alt = "Bild";
    row.appendChild(img);
  } else {
    const bubble = document.createElement("div");
    bubble.className = "message";
    bubble.textContent = m.text || "";
    row.appendChild(bubble);
  }

  const time = document.createElement("div");
  time.className = "message-time";
  time.textContent = fmtTime(m.timestamp);
  row.appendChild(time);

  chatBox.appendChild(row);
}

messageForm.addEventListener("submit", async e => {
  e.preventDefault();
  if (!selectedPeer) return;
  const text = messageInput.value.trim();
  if (!text) return;
  messageInput.value = "";
  try {
    await addDoc(collection(db, "messages"), {
      from: me.uid, fromName: me.name, to: selectedPeer.id,
      type: "text", text, timestamp: Date.now()
    });
  } catch (err) {
    alert("Nachricht konnte nicht gesendet werden: " + friendlyAuthError(err));
  }
});

/* ================= Bilder ================= */
imageInput.addEventListener("change", e => {
  selectedFile = e.target.files[0] || null;
  if (!selectedFile) return hidePreview();
  previewImg.src = URL.createObjectURL(selectedFile);
  previewName.textContent = selectedFile.name;
  previewBar.style.display = "flex";
});

function hidePreview() {
  previewBar.style.display = "none";
  if (previewImg.src) URL.revokeObjectURL(previewImg.src);
  previewImg.src = "";
  selectedFile = null;
  imageInput.value = "";
}
previewCancel.onclick = hidePreview;

sendImageBtn.onclick = async () => {
  if (!selectedPeer || !selectedFile) return;
  sendImageBtn.disabled = true;
  sendImageBtn.textContent = "Wird gesendet…";
  try {
    const clean = selectedFile.name.replace(/[^\w.\-]/g, "_");
    const path = `chatImages/${me.uid}_${Date.now()}_${clean}`;
    const storageRef = ref(storage, path);
    const snap = await uploadBytes(storageRef, selectedFile);
    const url = await getDownloadURL(snap.ref);
    await addDoc(collection(db, "messages"), {
      from: me.uid, fromName: me.name, to: selectedPeer.id,
      type: "image", url, timestamp: Date.now()
    });
    hidePreview();
  } catch (err) {
    alert("Bild konnte nicht gesendet werden: " + friendlyAuthError(err));
  } finally {
    sendImageBtn.disabled = false;
    sendImageBtn.textContent = "Bild senden";
  }
};

/* ================= Anrufe (1:1 Audio/Video via WebRTC + Firestore-Signaling) =================
   Hinweis: Gruppen-Anrufe sind bewusst nicht enthalten – die ursprüngliche Datei
   webchat-full.js brach die Gruppenanruf-Logik unvollständig ab ("...rest of group
   call logic..."). Stattdessen gibt es hier voll funktionsfähige 1:1-Anrufe.
================================================================================= */

function addVideoTile(id, label, stream, muted) {
  removeVideoTile(id);
  const tile = document.createElement("div");
  tile.className = "video-tile";
  tile.id = "tile_" + id;
  const video = document.createElement("video");
  video.autoplay = true;
  video.playsInline = true;
  video.muted = !!muted;
  video.srcObject = stream;
  const span = document.createElement("span");
  span.textContent = label;
  tile.appendChild(video);
  tile.appendChild(span);
  videoGrid.appendChild(tile);
  videoGrid.classList.add("active");
}
function removeVideoTile(id) {
  const el = document.getElementById("tile_" + id);
  if (el) el.remove();
}
function clearVideoGrid() {
  videoGrid.innerHTML = "";
  videoGrid.classList.remove("active");
}

function createPeerConnection(callId, role) {
  const connection = new RTCPeerConnection({ iceServers: ICE_SERVERS });
  const outgoingCol = role === "caller" ? "callerCandidates" : "calleeCandidates";
  const incomingCol = role === "caller" ? "calleeCandidates" : "callerCandidates";

  connection.onicecandidate = ev => {
    if (ev.candidate) {
      addDoc(collection(db, "calls", callId, outgoingCol), ev.candidate.toJSON()).catch(console.error);
    }
  };
  connection.ontrack = ev => {
    addVideoTile("remote", selectedPeer ? selectedPeer.name : "Gegenstelle", ev.streams[0], false);
  };

  iceUnsub = onSnapshot(collection(db, "calls", callId, incomingCol), snap => {
    snap.docChanges().forEach(change => {
      if (change.type === "added") {
        connection.addIceCandidate(new RTCIceCandidate(change.doc.data())).catch(console.error);
      }
    });
  });

  return connection;
}

async function getLocalMedia(withVideo) {
  localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: withVideo });
  addVideoTile("local", "Du", localStream, true);
  return localStream;
}

async function startCall(type) {
  if (!selectedPeer || selectedPeer.type !== "user" || currentCallId) return;
  try {
    await getLocalMedia(type === "video");
  } catch (err) {
    alert("Kamera/Mikrofon konnte nicht geöffnet werden: " + (err.message || err));
    return;
  }

  currentCallRole = "caller";
  const callDocRef = await addDoc(collection(db, "calls"), {
    from: me.uid, fromName: me.name, to: selectedPeer.id, type,
    status: "ringing", createdAt: Date.now()
  });
  currentCallId = callDocRef.id;

  pc = createPeerConnection(currentCallId, "caller");
  localStream.getTracks().forEach(t => pc.addTrack(t, localStream));

  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  await updateDoc(callDocRef, { offer: { sdp: offer.sdp, type: offer.type } });

  endCallBtn.style.display = "inline-flex";

  callDocUnsub = onSnapshot(doc(db, "calls", currentCallId), async snap => {
    const data = snap.data();
    if (!data) return;
    if (data.answer && pc && !pc.currentRemoteDescription) {
      await pc.setRemoteDescription(new RTCSessionDescription(data.answer));
    }
    if (data.status === "declined") {
      alert(`${selectedPeer.name} hat den Anruf abgelehnt.`);
      endCall();
    }
    if (data.status === "ended") endCall();
  });
}

audioCallBtn.onclick = () => startCall("audio");
videoCallBtn.onclick = () => startCall("video");

function setupIncomingCallWatcher() {
  const q = query(collection(db, "calls"), where("to", "==", me.uid), where("status", "==", "ringing"));
  incomingCallsUnsub = onSnapshot(q, snap => {
    snap.docChanges().forEach(change => {
      if (change.type === "added" && !currentCallId) {
        const data = change.doc.data();
        pendingIncomingCall = { id: change.doc.id, ...data };
        popupCaller.textContent = `${data.fromName || "Unbekannt"} ruft an (${data.type === "video" ? "Video" : "Audio"})`;
        popupAvatar.textContent = initials(data.fromName);
        incomingPopup.style.display = "flex";
        ringSound.currentTime = 0;
        ringSound.play().catch(() => {});
      }
    });
  }, err => console.error("Anruf-Überwachung fehlgeschlagen:", err));
}
let pendingIncomingCall = null;

acceptCallBtn.onclick = async () => {
  if (!pendingIncomingCall) return;
  const call = pendingIncomingCall;
  incomingPopup.style.display = "none";
  ringSound.pause();
  pendingIncomingCall = null;

  try {
    await getLocalMedia(call.type === "video");
  } catch (err) {
    alert("Kamera/Mikrofon konnte nicht geöffnet werden: " + (err.message || err));
    await updateDoc(doc(db, "calls", call.id), { status: "declined" });
    return;
  }

  currentCallId = call.id;
  currentCallRole = "callee";
  pc = createPeerConnection(call.id, "callee");
  localStream.getTracks().forEach(t => pc.addTrack(t, localStream));

  await pc.setRemoteDescription(new RTCSessionDescription(call.offer));
  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);
  await updateDoc(doc(db, "calls", call.id), {
    answer: { sdp: answer.sdp, type: answer.type }, status: "accepted"
  });

  endCallBtn.style.display = "inline-flex";

  callDocUnsub = onSnapshot(doc(db, "calls", call.id), snap => {
    const data = snap.data();
    if (data && data.status === "ended") endCall();
  });
};

declineCallBtn.onclick = async () => {
  if (!pendingIncomingCall) return;
  await updateDoc(doc(db, "calls", pendingIncomingCall.id), { status: "declined" }).catch(console.error);
  incomingPopup.style.display = "none";
  ringSound.pause();
  pendingIncomingCall = null;
};

function endCall() {
  if (currentCallId) {
    updateDoc(doc(db, "calls", currentCallId), { status: "ended" }).catch(() => {});
  }
  if (pc) { try { pc.close(); } catch (e) {} pc = null; }
  if (localStream) { localStream.getTracks().forEach(t => t.stop()); localStream = null; }
  if (callDocUnsub) { callDocUnsub(); callDocUnsub = null; }
  if (iceUnsub) { iceUnsub(); iceUnsub = null; }
  currentCallId = null;
  currentCallRole = null;
  clearVideoGrid();
  endCallBtn.style.display = "none";
}
endCallBtn.onclick = endCall;
