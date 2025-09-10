import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { getAuth, signInAnonymously, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { getFirestore, collection, doc, addDoc, getDoc, setDoc, onSnapshot, updateDoc, arrayUnion, query, serverTimestamp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

// --- Configuration ---
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

const walksCollection = collection(db, 'walks');
const usersCollection = collection(db, 'users');

let currentUser = null;
let userProfile = null;
let unsubscribeWalks = null;
let isInitialLoad = true;

// --- DOM Elements ---
const userModal = document.getElementById('user-modal');
const userNameForm = document.getElementById('user-name-form');
const usernameInput = document.getElementById('username');
const walksList = document.getElementById('walks-list');
const createWalkForm = document.getElementById('create-walk-form');
const welcomeMessage = document.getElementById('welcome-message');
const loadingDiv = document.getElementById('loading');
const noWalksDiv = document.getElementById('no-walks');
const toast = document.getElementById('toast');
const toastMessage = document.getElementById('toast-message');
const refreshBtn = document.getElementById('refresh-btn');
const notificationsBtn = document.getElementById('notifications-btn');

// --- Utility Functions ---
function showToast(message) {
    toastMessage.textContent = message;
    toast.classList.remove('opacity-0', 'translate-y-10');
    setTimeout(() => {
        toast.classList.add('opacity-0', 'translate-y-10');
    }, 3000);
}

function formatWalkDate(date) {
    if (!date || isNaN(new Date(date))) return "Invalid date";
    return new Date(date).toLocaleString('en-US', {
        weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
        hour: 'numeric', minute: '2-digit', hour12: true
    });
}

// --- Weather Fetching Logic ---
function weatherCodeToInfo(code) {
    const codes = {
        0: { icon: '☀️' }, 1: { icon: '🌤️' }, 2: { icon: '⛅' }, 3: { icon: '☁️' },
        45: { icon: '🌫️' }, 48: { icon: '🌫️' },
        51: { icon: '🌦️' }, 53: { icon: '🌦️' }, 55: { icon: '🌦️' },
        61: { icon: '🌧️' }, 63: { icon: '🌧️' }, 65: { icon: '🌧️' },
        80: { icon: '🌦️' }, 81: { icon: '🌦️' }, 82: { icon: '🌦️' },
    };
    return codes[code] || { icon: '' };
}

async function fetchWeatherForWalk(dateTimeString) {
    try {
        const walkDate = new Date(dateTimeString);
        if (isNaN(walkDate)) return null;

        const sevenDaysFromNow = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
        if (walkDate > sevenDaysFromNow) return null;

        const dateISO = walkDate.toISOString().split('T')[0];
        const walkHour = walkDate.getHours();

        const apiUrl = `https://api.open-meteo.com/v1/forecast?latitude=51.5074&longitude=-0.1278&hourly=temperature_2m,weathercode&timezone=Europe/London&start_date=${dateISO}&end_date=${dateISO}`;
        
        const response = await fetch(apiUrl);
        if (!response.ok) return null;
        
        const data = await response.json();
        if (!data.hourly || !data.hourly.time) return null;

        const hourIndex = data.hourly.time.findIndex(time => new Date(time).getHours() === walkHour);
        if (hourIndex === -1) return null;

        const temperature = Math.round(data.hourly.temperature_2m[hourIndex]);
        const weatherCode = data.hourly.weathercode[hourIndex];
        const { icon } = weatherCodeToInfo(weatherCode);

        return { temperature, icon };
    } catch (error) {
        console.error("Failed to fetch weather:", error);
        return null;
    }
}

// --- Browser Notification Logic ---
function setupNotifications() {
    if (!('Notification' in window)) {
        notificationsBtn.style.display = 'none';
        return;
    }
    const bellIcon = notificationsBtn.querySelector('svg');
    if (Notification.permission === 'granted') {
         bellIcon.style.color = '#10b981';
    } else if (Notification.permission === 'denied') {
        notificationsBtn.disabled = true;
        notificationsBtn.title = "Notifications are blocked in your browser settings.";
    }
    notificationsBtn.addEventListener('click', async () => {
        if (Notification.permission !== 'granted') {
            const permission = await Notification.requestPermission();
            if (permission === 'granted') {
                bellIcon.style.color = '#10b981';
                showToast('Browser notifications enabled!');
                new Notification('The Paw Society', {
                    body: 'You will now be notified of new walks!',
                    icon: 'https://placehold.co/96x96/10b981/FFFFFF?text=🐾'
                });
            } else {
                showToast('Notifications were not enabled.');
            }
        }
    });
}

function showBrowserNotification(title, body) {
    if (Notification.permission === 'granted' && document.hidden) {
         new Notification(title, {
            body: body,
            icon: 'https://placehold.co/96x96/10b981/FFFFFF?text=🐾'
        });
    }
}

// --- Main Application Logic ---
onAuthStateChanged(auth, async (user) => {
    if (user) {
        currentUser = user;
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

userNameForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = usernameInput.value.trim();
    if (name && currentUser) {
        const userDocRef = doc(usersCollection, currentUser.uid);
        await setDoc(userDocRef, { name });
        userProfile = { id: currentUser.uid, name };
        userModal.classList.add('hidden');
        welcomeMessage.textContent = `Welcome, ${userProfile.name}!`;
        welcomeMessage.classList.remove('hidden');
        setupNotifications();
        fetchAndRenderWalks();
        showToast(`Welcome aboard, ${name}!`);
    }
});

createWalkForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!userProfile) { showToast("Please enter your name first."); return; }
    const location = createWalkForm.location.value.trim();
    const dateTime = createWalkForm.datetime.value;
    const description = createWalkForm.description.value.trim();

    if (!location || !dateTime) { showToast("Please fill in location and date/time."); return; }
    
    if (new Date(dateTime) < new Date()) {
        showToast("You can't schedule a walk in the past!");
        return;
    }

    const submitButton = createWalkForm.querySelector('button[type="submit"]');
    submitButton.disabled = true;
    submitButton.textContent = 'Creating...';
    try {
        await addDoc(walksCollection, {
            location, dateTime, description,
            creatorId: userProfile.id,
            attendees: [{ userId: userProfile.id, userName: userProfile.name }],
            createdAt: serverTimestamp()
        });
        createWalkForm.reset();
        showToast("Walk created successfully!");
    } catch (error) {
        console.error("Error creating walk: ", error);
        showToast("Failed to create walk.");
    } finally {
        submitButton.disabled = false;
        submitButton.textContent = 'Create Walk';
    }
});

function fetchAndRenderWalks() {
    if (unsubscribeWalks) unsubscribeWalks();
    const q = query(walksCollection);
    
    unsubscribeWalks = onSnapshot(q, (snapshot) => {
        loadingDiv.style.display = 'none';
        
        if (!isInitialLoad && userProfile) {
            snapshot.docChanges().forEach((change) => {
                if (change.type === 'added') {
                    const walkData = change.doc.data();
                    if (walkData.creatorId !== userProfile.id) {
                        const hostName = walkData.attendees.find(att => att.userId === walkData.creatorId)?.userName || 'A user';
                        const message = `At "${walkData.location}" by ${hostName}`;
                        showToast(`New walk posted!`);
                        showBrowserNotification('New Walk Posted!', message);
                    }
                }
            });
        }
        const walks = snapshot.docs
            .map(doc => ({ id: doc.id, ...doc.data() }))
            .sort((a, b) => {
                const dateA = new Date(a.dateTime);
                const dateB = new Date(b.dateTime);
                if (isNaN(dateA)) return 1;
                if (isNaN(dateB)) return -1;
                return dateA - dateB;
            });
        
        renderWalks(walks);
        isInitialLoad = false;
    }, (error) => {
        console.error("Error fetching walks:", error);
        loadingDiv.innerText = "Error loading walks.";
    });
}

async function renderWalks(walks) {
    walksList.innerHTML = '';
    noWalksDiv.classList.add('hidden');
    
    const now = new Date();
    const upcomingWalks = walks.filter(walk => new Date(walk.dateTime) >= now);
    const pastWalks = walks.filter(walk => new Date(walk.dateTime) < now).reverse();

    if (upcomingWalks.length === 0 && pastWalks.length === 0) {
        noWalksDiv.classList.remove('hidden');
        walksList.innerHTML = ''; // Ensure list is clear
        return;
    }

    if (upcomingWalks.length > 0) {
        const upcomingHeader = document.createElement('h2');
        upcomingHeader.className = "text-2xl font-semibold mb-4 text-slate-800";
        upcomingHeader.textContent = "Upcoming Walks";
        walksList.appendChild(upcomingHeader);
        const walkCardPromises = upcomingWalks.map(walk => createWalkCard(walk, false));
        const walkCards = await Promise.all(walkCardPromises);
        walkCards.forEach(card => walksList.appendChild(card));
    }

     if (pastWalks.length > 0) {
        const pastHeader = document.createElement('h2');
        pastHeader.className = "text-2xl font-semibold mt-8 mb-4 text-slate-800";
        pastHeader.textContent = "Past Walks";
        walksList.appendChild(pastHeader);
        for (const walk of pastWalks) {
            const walkCard = await createWalkCard(walk, true);
            walksList.appendChild(walkCard);
        }
    }
}

async function createWalkCard(walk, isPast) {
    const isAttending = userProfile && walk.attendees.some(att => att.userId === userProfile.id);
    
    const walkCard = document.createElement('div');
    walkCard.className = `bg-white p-5 rounded-xl shadow-lg ${isPast ? 'opacity-70' : 'transition-transform transform hover:scale-[1.02]'}`;

    const headerDiv = document.createElement('div');
    headerDiv.className = 'flex flex-col sm:flex-row justify-between sm:items-center border-b border-slate-200 pb-3 mb-3';

    const titleDiv = document.createElement('div');
    const locationH3 = document.createElement('h3');
    locationH3.className = `text-xl font-bold ${isPast ? 'text-slate-500' : 'text-emerald-600'}`;
    locationH3.textContent = walk.location;
    
    const dateP = document.createElement('p');
    dateP.className = 'text-sm text-slate-500 flex items-center';
    
    // FIX: Create a text node for the date first, then append weather if available
    const dateTextNode = document.createTextNode(formatWalkDate(walk.dateTime));
    dateP.appendChild(dateTextNode);

    if (!isPast) {
        const weather = await fetchWeatherForWalk(walk.dateTime);
        if (weather) {
            const weatherSpan = document.createElement('span');
            weatherSpan.className = 'font-medium ml-2 text-slate-600';
            weatherSpan.textContent = ` ${weather.icon} ${weather.temperature}°C`;
            dateP.appendChild(weatherSpan);
        }
    }

    titleDiv.append(locationH3, dateP);

    let joinButton;
    if (isPast) {
        joinButton = document.createElement('span');
        joinButton.className = 'mt-3 sm:mt-0 px-5 py-2 rounded-lg font-semibold text-slate-500 bg-slate-200 cursor-default';
        joinButton.textContent = 'Completed';
    } else {
        joinButton = document.createElement('button');
        joinButton.dataset.walkId = walk.id;
        joinButton.className = `join-btn mt-3 sm:mt-0 px-5 py-2 rounded-lg font-semibold text-white transition`;
        if (isAttending) {
            joinButton.classList.add('bg-slate-400', 'cursor-not-allowed');
            joinButton.textContent = 'You are going!';
            joinButton.disabled = true;
        } else {
            joinButton.classList.add('bg-blue-500', 'hover:bg-blue-600');
            joinButton.textContent = 'Join Walk';
        }
    }
    
    headerDiv.append(titleDiv, joinButton);
    
    const descriptionP = document.createElement('p');
    descriptionP.className = 'text-slate-600 mb-4';
    descriptionP.textContent = walk.description || 'No description provided.';

    const attendeesDiv = document.createElement('div');
    const attendeesH4 = document.createElement('h4');
    attendeesH4.className = 'font-semibold text-sm mb-2 text-slate-700';
    attendeesH4.textContent = `${isPast ? "Who went?" : "Who's going?"} (${walk.attendees.length})`;
    
    const attendeesListDiv = document.createElement('div');
    attendeesListDiv.className = 'flex flex-wrap gap-2';

    walk.attendees.forEach(att => {
        const attendeeSpan = document.createElement('span');
        attendeeSpan.className = 'bg-slate-100 text-slate-600 text-xs font-medium px-2.5 py-1 rounded-full';
        let attendeeText = att.userName;
        if (att.userId === walk.creatorId) {
            attendeeText += ' (Host)';
        }
        attendeeSpan.textContent = attendeeText;
        attendeesListDiv.appendChild(attendeeSpan);
    });
    
    attendeesDiv.append(attendeesH4, attendeesListDiv);
    walkCard.append(headerDiv, descriptionP, attendeesDiv);
    
    return walkCard;
}

walksList.addEventListener('click', async (e) => {
    if (e.target.classList.contains('join-btn')) {
        const walkId = e.target.dataset.walkId;
        if (!walkId || !userProfile) return;
        e.target.disabled = true;
        e.target.textContent = 'Joining...';
        
        try {
            const walkDocRef = doc(walksCollection, walkId);
            await updateDoc(walkDocRef, {
                attendees: arrayUnion({ userId: userProfile.id, userName: userProfile.name })
            });
            showToast('You have joined the walk!');
        } catch (error) {
            console.error("Error joining walk:", error);
            showToast('Could not join walk. Try again.');
            e.target.disabled = false;
            e.target.textContent = 'Join Walk';
        }
    }
});

refreshBtn.addEventListener('click', () => {
    showToast('Refreshing walks...');
    const icon = refreshBtn.querySelector('svg');
    icon.classList.add('spinning');
    fetchAndRenderWalks();
    icon.addEventListener('animationend', () => icon.classList.remove('spinning'), { once: true });
});

