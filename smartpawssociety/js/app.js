import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { getAuth, signInAnonymously, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { getFirestore, collection, doc, addDoc, getDoc, setDoc, onSnapshot, updateDoc, arrayUnion, query, where, serverTimestamp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

// --- Configuration ---
// Connecting to your personal Firebase project
const firebaseConfig = {
    apiKey: "AIzaSyDQXoIZZBszreZjVm1W8hdruxMerS1dy60",
    authDomain: "smartpawssociety.firebaseapp.com",
    projectId: "smartpawssociety",
    storageBucket: "smartpawssociety.appspot.com",
    messagingSenderId: "8526735724"
};
const appId = 'smartpawssociety';

// --- Firebase Initialization ---
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

const walksCollection = collection(db, 'walks');
const usersCollection = collection(db, 'users');

let currentUser = null;
let userProfile = null;
let unsubscribeWalks = null;
let isInitialLoad = true; // Flag to prevent notifications on first page load

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

// --- Utility Functions ---
function showToast(message) {
    toastMessage.textContent = message;
    toast.classList.remove('opacity-0', 'translate-y-10');
    setTimeout(() => {
        toast.classList.add('opacity-0', 'translate-y-10');
    }, 3000);
}

function formatWalkDate(date) {
    return new Date(date).toLocaleString('en-US', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        hour12: true
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
        // Only fetch for walks within the next 7 days
        if ((walkDate - new Date()) > 7 * 24 * 60 * 60 * 1000) return null;

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
        fetchAndRenderWalks();
        showToast(`Welcome aboard, ${name}!`);
    }
});

createWalkForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!userProfile) {
        showToast("Please enter your name first.");
        return;
    }

    const location = createWalkForm.location.value.trim();
    const dateTime = createWalkForm.datetime.value;
    const description = createWalkForm.description.value.trim();

    if (!location || !dateTime) {
        showToast("Please fill in location and date/time.");
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
                        const host = walkData.attendees.find(att => att.userId === walkData.creatorId);
                        const hostName = host ? host.userName : 'a user';
                        showToast(`New walk posted: "${walkData.location}" by ${hostName}`);
                    }
                }
            });
        }
        
        const walks = snapshot.docs
            .map(doc => ({ id: doc.id, ...doc.data() }))
            .sort((a, b) => new Date(a.dateTime) - new Date(b.dateTime));

        if (walks.length === 0) {
            noWalksDiv.classList.remove('hidden');
            walksList.innerHTML = '';
        } else {
            noWalksDiv.classList.add('hidden');
            renderWalks(walks);
        }
        
        isInitialLoad = false;
    }, (error) => {
        console.error("Error fetching walks:", error);
        loadingDiv.innerText = "Error loading walks.";
    });
}

async function renderWalks(walks) {
    walksList.innerHTML = '';
    const now = new Date();

    const upcomingWalks = walks.filter(walk => new Date(walk.dateTime) >= now);
    const pastWalks = walks.filter(walk => new Date(walk.dateTime) < now).reverse();

    const upcomingHeader = document.createElement('h2');
    upcomingHeader.className = "text-2xl font-semibold mb-4 text-slate-800";
    upcomingHeader.textContent = "Upcoming Walks";
    walksList.appendChild(upcomingHeader);

    if (upcomingWalks.length > 0) {
        const walkCardPromises = upcomingWalks.map(walk => createWalkCard(walk, false));
        const walkCards = await Promise.all(walkCardPromises);
        walkCards.forEach(card => walksList.appendChild(card));
    } else {
         const noUpcoming = document.createElement('p');
         noUpcoming.className = "text-center text-slate-500 py-8 bg-white rounded-2xl shadow-md";
         noUpcoming.textContent = "No upcoming walks scheduled. Why not create one?";
         walksList.appendChild(noUpcoming);
    }

     if (pastWalks.length > 0) {
        const pastHeader = document.createElement('h2');
        pastHeader.className = "text-2xl font-semibold mt-8 mb-4 text-slate-800";
        pastHeader.textContent = "Past Walks";
        walksList.appendChild(pastHeader);
        
        // No need to fetch weather for past walks, so no promise.all is needed
        pastWalks.forEach(walk => {
            const walkCard = createWalkCard(walk, true);
            walksList.appendChild(walkCard);
        });
    }
}

async function createWalkCard(walk, isPast) {
    const isAttending = userProfile && walk.attendees.some(att => att.userId === userProfile.id);

    const walkCard = document.createElement('div');
    walkCard.className = `bg-white p-5 rounded-xl shadow-lg ${isPast ? 'opacity-70' : 'transition-transform transform hover:scale-[1.02]'}`;
    
    let joinButtonHtml = '';
    if (isPast) {
        joinButtonHtml = `<span class="mt-3 sm:mt-0 px-5 py-2 rounded-lg font-semibold text-slate-500 bg-slate-200 cursor-default">Completed</span>`;
    } else {
        joinButtonHtml = `<button 
                data-walk-id="${walk.id}" 
                class="join-btn mt-3 sm:mt-0 px-5 py-2 rounded-lg font-semibold text-white transition ${isAttending ? 'bg-slate-400 cursor-not-allowed' : 'bg-blue-500 hover:bg-blue-600'}"
                ${isAttending ? 'disabled' : ''}
            >
                ${isAttending ? 'You are going!' : 'Join Walk'}
            </button>`;
    }
    
    const whoIsGoingText = isPast ? "Who went?" : "Who's going?";

    let weatherHtml = '';
    if (!isPast) {
        const weather = await fetchWeatherForWalk(walk.dateTime);
        if (weather) {
            weatherHtml = `<span class="font-medium ml-2 text-slate-600">${weather.icon} ${weather.temperature}°C</span>`;
        }
    }

    walkCard.innerHTML = `
        <div class="flex flex-col sm:flex-row justify-between sm:items-center border-b border-slate-200 pb-3 mb-3">
            <div>
                <h3 class="text-xl font-bold ${isPast ? 'text-slate-500' : 'text-emerald-600'}">${walk.location}</h3>
                <p class="text-sm text-slate-500 flex items-center">${formatWalkDate(walk.dateTime)} ${weatherHtml}</p>
            </div>
            ${joinButtonHtml}
        </div>
        <p class="text-slate-600 mb-4">${walk.description || 'No description provided.'}</p>
        <div>
            <h4 class="font-semibold text-sm mb-2 text-slate-700">${whoIsGoingText} (${walk.attendees.length})</h4>
            <div class="flex flex-wrap gap-2">
                ${walk.attendees.map(att => `<span class="bg-slate-100 text-slate-600 text-xs font-medium px-2.5 py-1 rounded-full">${att.userName} ${att.userId === walk.creatorId ? '(Host)' : ''}</span>`).join('')}
            </div>
        </div>
    `;
    return walkCard;
}

walksList.addEventListener('click', async (e) => {
    if (e.target.classList.contains('join-btn')) {
        const walkId = e.target.dataset.walkId;
        if (!walkId || !userProfile) return;

        e.target.disabled = true;
        e.target.textContent = 'Joining...';
        
        const walkDocRef = doc(walksCollection, walkId);
        try {
            await updateDoc(walkDocRef, {
                attendees: arrayUnion({
                    userId: userProfile.id,
                    userName: userProfile.name
                })
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

    icon.addEventListener('animationend', () => {
        icon.classList.remove('spinning');
    }, { once: true });
});

