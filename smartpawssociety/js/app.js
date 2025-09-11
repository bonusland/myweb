import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { getAuth, signInAnonymously, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { getFirestore, collection, doc, addDoc, getDoc, setDoc, onSnapshot, updateDoc, arrayUnion, query, serverTimestamp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

// --- OneSignal Configuration ---
const ONE_SIGNAL_APP_ID = "63c09e55-7a20-4640-b990-a699b5a3945a"; // PASTE YOUR ONESIGNAL APP ID HERE

// --- Firebase Configuration ---
const firebaseConfig = {
    apiKey: "AIzaSyDQXoIZZBszreZjVm1W8hdruxMerS1dy60",
    authDomain: "smartpawssociety.firebaseapp.com",
    projectId: "smartpawssociety",
    storageBucket: "smartpawssociety.appspot.com",
    messagingSenderId: "8526735724"
};

// --- Firebase Initialization ---
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// ... (rest of the variables and DOM elements are the same)

// --- OneSignal & Notification Logic ---
window.OneSignalDeferred = window.OneSignalDeferred || [];
OneSignalDeferred.push(function(OneSignal) {
    OneSignal.init({
      appId: ONE_SIGNAL_APP_ID,
    });
});

function setupNotifications() {
    const bellIcon = notificationsBtn.querySelector('svg');
    
    // Check if notifications are enabled and update UI
    OneSignalDeferred.push(function(OneSignal) {
        OneSignal.Notifications.getPermissionStatus().then(status => {
            if (status === 'granted') {
                bellIcon.style.color = '#10b981';
            } else if (status === 'denied') {
                notificationsBtn.disabled = true;
                notificationsBtn.title = "Notifications are blocked in your browser settings.";
            }
        });
    });

    notificationsBtn.addEventListener('click', () => {
        OneSignalDeferred.push(function(OneSignal) {
            OneSignal.Notifications.requestPermission()
                .then((permission) => {
                    if (permission === 'granted') {
                        bellIcon.style.color = '#10b981';
                        showToast('Push notifications enabled!');
                    } else {
                        showToast('Notifications were not enabled.');
                    }
                });
        });
    });
}

// --- Main Application Logic ---
onAuthStateChanged(auth, async (user) => {
    if (user) {
        currentUser = user;
        // OneSignal: Identify the user
        OneSignalDeferred.push(function(OneSignal) {
            OneSignal.login(currentUser.uid);
        });

        const userDocRef = doc(usersCollection, currentUser.uid);
        const userDoc = await getDoc(userDocRef);
        if (userDoc.exists()) {
            userProfile = { id: currentUser.uid, ...userDoc.data() };
            userModal.classList.add('hidden');
            welcomeMessage.textContent = `Welcome back, ${userProfile.name}!`;
            welcomeMessage.classList.remove('hidden');
            setupNotifications();
            fetchAndRenderWalks();
        } else {
            userModal.classList.remove('hidden');
        }
    } else {
        await signInAnonymously(auth);
    }
});

// ... (The rest of the js/app.js file remains the same)

