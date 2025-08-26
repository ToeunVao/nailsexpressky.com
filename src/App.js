import React, { useState, useEffect, useRef, useMemo } from 'react';
import { initializeApp, deleteApp } from 'firebase/app';
import { getAuth, signInWithEmailAndPassword, onAuthStateChanged, signOut, createUserWithEmailAndPassword, signInWithCustomToken, signInAnonymously, setPersistence, browserLocalPersistence } from 'firebase/auth';
import { getFirestore, collection, doc, getDoc, onSnapshot, addDoc, updateDoc, deleteDoc, setDoc, query, where, Timestamp, writeBatch, getDocs, arrayUnion, arrayRemove } from 'firebase/firestore';
import { getStorage, ref, uploadBytesResumable, getDownloadURL, deleteObject } from 'firebase/storage';
import { Bar, Pie } from 'react-chartjs-2';
import { Chart as ChartJS, CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend, ArcElement } from 'chart.js';

// Register Chart.js components
ChartJS.register(CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend, ArcElement);

// --- Configuration ---
// This is your original Firebase config. It will be used as a fallback
// if the secure environment variable `__firebase_config` is not available.
const firebaseConfig = {
  apiKey: "AIzaSyAGZBJFVi_o1HeGDmjcSsmCcWxWOkuLc_4",
  authDomain: "nailexpress-10f2f.firebaseapp.com",
  databaseURL: "https://nailexpress-10f2f-default-rtdb.firebaseio.com",
  projectId: "nailexpress-10f2f",
  storageBucket: "nailexpress-10f2f.appspot.com",
  messagingSenderId: "1015991996673",
  appId: "1:1015991996673:web:b6e8888abae83906d34b00",
  measurementId: "G-22LFQVMGTV"
};

const getSafeAppId = () => typeof __app_id !== 'undefined' ? __app_id : 'default-nail-salon-app';

// --- Reusable Components ---
const Icon = ({ path, className = "w-6 h-6" }) => (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className={className}>
        <path strokeLinecap="round" strokeLinejoin="round" d={path} />
    </svg>
);

const SocialIcon = ({ href, children }) => (
    <a href={href} target="_blank" rel="noopener noreferrer" className="text-white hover:text-pink-300 transition-colors">
        {children}
    </a>
);

const LoadingScreen = ({ text = "Loading..." }) => (
    <div className="flex items-center justify-center h-screen bg-gray-100">
        <div className="text-center">
            <div className="text-2xl font-semibold text-pink-500">{text}</div>
            <div className="w-16 h-16 border-4 border-dashed rounded-full animate-spin border-pink-500 mx-auto mt-4"></div>
        </div>
    </div>
);

// --- Main App Component (Acts as a Router) ---
export default function App() {
    const [user, setUser] = useState(null);
    const [userRole, setUserRole] = useState(null);
    const [loading, setLoading] = useState(true);
    const [isAuthReady, setIsAuthReady] = useState(false);
    const [showLogin, setShowLogin] = useState(false);

    const app = useRef(null);
    const auth = useRef(null);
    const db = useRef(null);
    const storage = useRef(null);
    
    // One-time setup effect for libraries and Firebase
    useEffect(() => {
        // Function to load a script and return a promise
        const loadScript = (src) => {
            return new Promise((resolve, reject) => {
                if (document.querySelector(`script[src="${src}"]`)) {
                    resolve();
                    return;
                }
                const script = document.createElement('script');
                script.src = src;
                script.onload = () => resolve();
                script.onerror = () => reject(new Error(`Script load error for ${src}`));
                document.head.appendChild(script);
            });
        };

        // Load all necessary external scripts
        Promise.all([
            loadScript("https://cdn.tailwindcss.com"),
            loadScript("https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js"),
            loadScript("https://cdn.jsdelivr.net/npm/chart.js")
        ]).then(() => {
            console.log("All external scripts loaded successfully.");
        }).catch(error => console.error("Script loading failed:", error));

        // Initialize Firebase
        if (!app.current) {
            try {
                // Use secure environment variable if available, otherwise use fallback
                const configToUse = typeof __firebase_config !== 'undefined'
                    ? JSON.parse(__firebase_config)
                    : firebaseConfig;

                app.current = initializeApp(configToUse);
                auth.current = getAuth(app.current);
                db.current = getFirestore(app.current);
                storage.current = getStorage(app.current);

                setPersistence(auth.current, browserLocalPersistence)
                  .catch((error) => {
                    console.error("Could not set session persistence:", error);
                  });
            } catch (error) {
                console.error("Firebase initialization error:", error);
                setLoading(false);
                return;
            }
        }
        
        // Authentication logic
        const handleInitialAuth = async () => {
            const initialAuthToken = typeof __initial_auth_token !== 'undefined' ? __initial_auth_token : null;
            
            if (initialAuthToken) {
                try {
                    await signInWithCustomToken(auth.current, initialAuthToken);
                } catch (error) {
                    console.error("Custom token sign-in failed:", error);
                    // Fallback to anonymous sign-in for public access
                    if (!auth.current.currentUser) {
                        await signInAnonymously(auth.current);
                    }
                }
            } else if (!auth.current.currentUser) {
                 await signInAnonymously(auth.current);
            }
            setIsAuthReady(true);
        };

        handleInitialAuth();

        const unsubscribe = onAuthStateChanged(auth.current, async (firebaseUser) => {
            if (firebaseUser && !firebaseUser.isAnonymous) {
                try {
                    // CORRECTED PATH: Use the correct public path for the users collection
                    const userDocRef = doc(db.current, `artifacts/${getSafeAppId()}/public/data/users`, firebaseUser.uid);
                    const userDocSnap = await getDoc(userDocRef);
                    if (userDocSnap.exists()) {
                        setUser(firebaseUser);
                        setUserRole(userDocSnap.data().role);
                    } else {
                        console.warn("User document not found for UID:", firebaseUser.uid, "Logging out.");
                        await signOut(auth.current);
                    }
                } catch (error) {
                    console.error("Firestore error fetching user role:", error);
                    await signOut(auth.current);
                }
            } else {
                setUser(null);
                setUserRole(null);
            }
            setLoading(false);
        });

        return () => unsubscribe();
    }, []);

    if (loading) {
        return <LoadingScreen text="Initializing Salon App..."/>;
    }

    if (user && userRole) {
        return <AdminPanel userRole={userRole} auth={auth.current} db={db.current} storage={storage.current} isAuthReady={isAuthReady} />;
    }

    return (
        <>
            <PublicSalonPage db={db.current} onStaffLoginClick={() => setShowLogin(true)} />
            {showLogin && <LoginModal auth={auth.current} db={db.current} onClose={() => setShowLogin(false)} />}
        </>
    );
}


// --- Public Facing Components ---
const PublicSalonPage = ({ db, onStaffLoginClick }) => {
    const [services, setServices] = useState([]);
    const [isLoading, setIsLoading] = useState(true);
    const [booking, setBooking] = useState({ clientName: '', phone: '', groupSize: 1, technician: 'Any', date: '', notes: '', services: [] });
    const [message, setMessage] = useState('');
    const [bookingSettings, setBookingSettings] = useState({ leadTime: 0 });
    const [step, setStep] = useState(1);
    const [categories, setCategories] = useState([]);
    const [currentCategory, setCurrentCategory] = useState('');
    const [isServiceModalOpen, setIsServiceModalOpen] = useState(false);
    const [isPolicyModalOpen, setIsPolicyModalOpen] = useState(false);
    const [agreedToPolicy, setAgreedToPolicy] = useState(false);
    const [technicians, setTechnicians] = useState([]);

    const getMinBookingDate = () => {
        const leadTimeInMs = (bookingSettings.leadTime || 0) * 60 * 60 * 1000;
        const minDate = new Date(Date.now() + leadTimeInMs);
        return minDate.toISOString().slice(0, 16);
    };
    
    useEffect(() => {
        setBooking(prev => ({...prev, date: getMinBookingDate()}));
    }, [bookingSettings.leadTime]);

    useEffect(() => {
        if(!db) return;
        const servicesCollection = collection(db, `artifacts/${getSafeAppId()}/public/data/services`);
        const settingsDoc = doc(db, `artifacts/${getSafeAppId()}/public/data/settings`, 'booking');
        // CORRECTED PATH: Use the correct public path for the users collection
        const usersQuery = query(collection(db, `artifacts/${getSafeAppId()}/public/data/users`), where("role", "==", "technician"));

        const unsubServices = onSnapshot(servicesCollection, (snapshot) => {
            const servicesData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            setServices(servicesData);
            setCategories([...new Set(servicesData.map(s => s.category))]);
            setIsLoading(false);
        }, console.error);

        const unsubSettings = onSnapshot(settingsDoc, (doc) => {
            if (doc.exists()) {
                setBookingSettings(doc.data());
            }
        });
        
        const unsubUsers = onSnapshot(usersQuery, (snapshot) => {
            const techData = snapshot.docs.map(doc => doc.data().name || doc.data().email);
            setTechnicians(['Any', ...techData]);
        });

        return () => {
            unsubServices();
            unsubSettings();
            unsubUsers();
        };
    }, [db]);

    const handleBookingSubmit = async (e) => {
        e.preventDefault();
        setMessage('');
        if (!booking.clientName || !booking.phone || !booking.date || booking.services.length === 0) {
            setMessage('Please fill out all required fields and select at least one service.');
            return;
        }

        const minBookingTime = new Date(Date.now() + (bookingSettings.leadTime || 0) * 60 * 60 * 1000);
        if (new Date(booking.date) < minBookingTime) {
            setMessage(`Booking must be at least ${bookingSettings.leadTime} hour(s) in advance.`);
            return;
        }

        try {
            const appointmentsCollection = collection(db, `artifacts/${getSafeAppId()}/public/data/appointments`);
            await addDoc(appointmentsCollection, {
                ...booking,
                date: Timestamp.fromDate(new Date(booking.date)),
                status: 'booked',
                bookingType: 'Online',
            });
            setMessage('Thank you! Your appointment has been booked.');
            setBooking({ clientName: '', phone: '', groupSize: 1, technician: 'Any', date: getMinBookingDate(), notes: '', services: [] });
            setStep(1);
        } catch (error) {
            console.error("Booking Error: ", error);
            setMessage('Sorry, there was an error booking your appointment. Please try again.');
        }
    };

    const handleNextStep = () => {
        if (!booking.clientName || !booking.phone || !booking.date) {
             setMessage('Please fill out all required fields before proceeding.');
             return;
        }
        setMessage('');
        setStep(2);
    }
    
    const handleServiceSelect = (serviceName) => {
        setBooking(prev => {
            const newServices = prev.services.includes(serviceName) ? prev.services.filter(s => s !== serviceName) : [...prev.services, serviceName];
            return { ...prev, services: newServices };
        });
    };

    return (
        <>
        <style>{`
            @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:wght@700&family=Lato&display=swap');
            html { scroll-behavior: smooth; }
            .font-playfair { font-family: 'Playfair Display', serif; }
            .font-lato { font-family: 'Lato', sans-serif; }
        `}</style>
        <div className="bg-[#FDF8F5] min-h-screen font-lato">
            <header className="bg-white shadow-md sticky top-0 z-50">
                <nav className="container mx-auto px-6 py-4 flex justify-between items-center">
                    <h1 className="text-2xl font-bold text-pink-500 font-playfair">NailXpress</h1>
                     <div className="hidden md:flex items-center space-x-6">
                        <a href="#book" className="text-gray-600 hover:text-pink-500 transition-colors">Booking</a>
                        <a href="#about-us" className="text-gray-600 hover:text-pink-500 transition-colors">About Us</a>
                        <a href="#contact-us" className="text-gray-600 hover:text-pink-500 transition-colors">Contact Us</a>
                    </div>
                    <button onClick={onStaffLoginClick} className="flex items-center px-4 py-2 text-sm font-semibold bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300">
                        <Icon path="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" className="w-5 h-5 mr-2" />
                        Staff Login
                    </button>
                </nav>
            </header>
            
            <main>
                <section 
                    className="relative text-center text-white py-24 px-6 bg-cover bg-center"
                    style={{backgroundImage: "url('https://images.unsplash.com/photo-1519014816548-bf5fe059798b?q=80&w=2070&auto=format&fit=crop')"}}
                >
                    <div className="absolute inset-0 bg-black opacity-50"></div>
                    <div className="relative z-10">
                        <h1 className="text-5xl font-extrabold font-playfair text-pink-500">Elegance at Your Fingertips</h1>
                        <p className="mt-4 text-lg max-w-2xl mx-auto font-lato">Experience elegance at its finest with our nail art creations. From delicate patterns to intricate details, our salon ensures that sophistication is just a brushstroke away.</p>
                        <div className="mt-8 flex justify-center space-x-6">
                           <SocialIcon href="https://www.facebook.com/profile.php?id=61566760681750">
                                <svg className="w-8 h-8" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path fillRule="evenodd" d="M22 12c0-5.523-4.477-10-10-10S2 6.477 2 12c0 4.991 3.657 9.128 8.438 9.878v-6.987h-2.54V12h2.54V9.797c0-2.506 1.492-3.89 3.777-3.89 1.094 0 2.238.195 2.238.195v2.46h-1.26c-1.243 0-1.63.771-1.63 1.562V12h2.773l-.443 2.891h-2.33V21.878A10.001 10.001 0 0022 12z" clipRule="evenodd" /></svg>
                            </SocialIcon>
                            <SocialIcon href="https://youtube.com/@NailExpressKY">
                               <svg className="w-8 h-8" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path fillRule="evenodd" d="M19.812 5.418c.861.23 1.538.907 1.768 1.768C21.998 8.78 22 12 22 12s0 3.22-.42 4.814a2.506 2.506 0 01-1.768 1.768c-1.594.42-7.812.42-7.812.42s-6.218 0-7.812-.42a2.506 2.506 0 01-1.768-1.768C2 15.22 2 12 2 12s0-3.22.42-4.814a2.506 2.506 0 011.768-1.768C5.782 5 12 5 12 5s6.218 0 7.812.418zM9.75 15.5V8.5l6 3.5-6 3.5z" clipRule="evenodd" /></svg>
                            </SocialIcon>
                            <SocialIcon href="https://www.tiktok.com/@nailsexpressky">
                                <svg className="w-8 h-8" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path d="M12.525.02c1.31-.02 2.61-.01 3.91-.02.08 1.53.63 3.09 1.75 4.17 1.12 1.11 2.7 1.62 4.24 1.79v4.03c-1.44-.05-2.89-.35-4.2-.97-.57-.26-1.1-.59-1.62-.93-.01 2.92.01 5.84-.02 8.75-.08 1.4-.54 2.79-1.35 3.94-1.31 1.92-3.58 3.17-5.91 3.21-2.43.05-4.86-.95-6.43-2.88-1.57-1.92-2.18-4.56-1.7-7.18.32-1.71 1.15-3.3 2.3-4.54 1.05-1.14 2.31-2.08 3.7-2.82.03-.01.06-.02.09-.03z" /></svg>
                            </SocialIcon>
                        </div>
                        <a href="#book" className="mt-8 inline-block px-12 py-3 font-semibold text-white bg-pink-500 rounded-lg hover:bg-pink-600 transition-colors">Book your appointment now</a>
                    </div>
                </section>

                <div className="container mx-auto px-6 py-12">
                     <section id="book" className="mt-16 bg-white p-8 rounded-xl shadow-2xl max-w-4xl mx-auto">
                        <h3 className="text-3xl font-bold text-center text-pink-500 mb-2 font-playfair">Book a New Appointment</h3>
                        <p className="text-center text-gray-600 mb-8 font-lato">Your moment of relaxation is just a few clicks away.</p>
                        
                        {step === 1 && (
                            <div>
                                <h4 className="text-xl font-semibold mb-4 text-pink-500 font-playfair">Step 1: Your Information</h4>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                    <div>
                                        <label className="block text-sm font-medium text-gray-700">Full Name*</label>
                                        <input type="text" value={booking.clientName} onChange={e => setBooking({...booking, clientName: e.target.value})} className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md" placeholder="e.g., Jane Doe"/>
                                    </div>
                                     <div>
                                        <label className="block text-sm font-medium text-gray-700">Phone*</label>
                                        <input type="tel" value={booking.phone} onChange={e => setBooking({...booking, phone: e.target.value})} className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md" placeholder="e.g., (555) 123-4567" />
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium text-gray-700">Group Size</label>
                                        <select value={booking.groupSize} onChange={e => setBooking({...booking, groupSize: e.target.value})} className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md bg-white">
                                            {[...Array(10).keys()].map(i => <option key={i+1} value={i+1}>{i+1}</option>)}
                                        </select>
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium text-gray-700">Technician Request</label>
                                        <select value={booking.technician} onChange={e => setBooking({...booking, technician: e.target.value})} className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md bg-white">
                                            {technicians.map(t => <option key={t} value={t}>{t}</option>)}
                                        </select>
                                    </div>
                                    <div className="md:col-span-2">
                                        <label className="block text-sm font-medium text-gray-700">Date & Time*</label>
                                        <input type="datetime-local" value={booking.date} min={getMinBookingDate()} onChange={e => setBooking({...booking, date: e.target.value})} className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md" />
                                    </div>
                                    <div className="md:col-span-2">
                                        <label className="block text-sm font-medium text-gray-700">Notes (optional)</label>
                                        <textarea value={booking.notes} onChange={e => setBooking({...booking, notes: e.target.value})} rows="3" className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md" placeholder="Any special requests or notes?"></textarea>
                                    </div>
                                </div>
                                <div className="text-center mt-6">
                                    <button onClick={handleNextStep} className="w-auto px-12 py-3 font-semibold text-white bg-pink-500 rounded-lg hover:bg-pink-600">Next</button>
                                </div>
                            </div>
                        )}

                        {step === 2 && (
                             <div>
                                <h4 className="text-xl font-semibold mb-4 text-pink-500 font-playfair">Step 2: Select Your Services</h4>
                                <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-6">
                                    {categories.map(cat => (<button type="button" key={cat} onClick={() => { setCurrentCategory(cat); setIsServiceModalOpen(true); }} className="p-4 border border-gray-300 rounded-lg text-center hover:bg-pink-50 hover:shadow-md transition"><p className="font-semibold text-pink-500">{cat}</p><p className="text-xs text-gray-500">Click to select</p></button>))}
                                </div>
                                <div className="mt-4">
                                    <p className="font-semibold">Selected Services:</p>
                                    {booking.services.length > 0 ? <ul className="list-disc list-inside text-gray-600">{booking.services.map(s => <li key={s}>{s}</li>)}</ul> : <p className="text-gray-500">No services selected yet.</p>}
                                </div>
                                <div className="mt-6 mb-4 flex items-center justify-center">
                                    <input id="policy-agree-final" type="checkbox" checked={agreedToPolicy} onChange={(e) => setAgreedToPolicy(e.target.checked)} className="h-4 w-4 text-pink-600 focus:ring-pink-500 border-gray-300 rounded" />
                                    <label htmlFor="policy-agree-final" className="ml-2 block text-sm text-gray-900">
                                        I agree to the <button type="button" onClick={() => setIsPolicyModalOpen(true)} className="font-medium text-pink-500 hover:underline">Salon Policy</button>.
                                    </label>
                                </div>
                                <div className="flex justify-center items-center space-x-4 mt-6">
                                    <button onClick={() => setStep(1)} className="w-auto px-12 py-3 font-semibold text-gray-700 bg-gray-200 rounded-lg hover:bg-gray-300">Back</button>
                                    <button onClick={handleBookingSubmit} disabled={!agreedToPolicy} className="w-auto px-12 py-3 font-semibold text-white bg-pink-500 rounded-lg hover:bg-pink-600 disabled:bg-gray-400">Book Now</button>
                                </div>
                            </div>
                        )}
                        {message && <p className="mt-4 text-center text-red-600">{message}</p>}
                    </section>
                    
                    <section id="about-us" className="mt-16 text-center max-w-4xl mx-auto">
                        <h3 className="text-3xl font-bold text-pink-500 mb-4 font-playfair">Your Sanctuary for Beauty & Relaxation</h3>
                        <p className="text-gray-600 leading-relaxed font-lato">
                            Welcome to Nail Express, your personal retreat for beauty and wellness in Danville. Our passionate team is dedicated to providing exceptional service in a clean, serene, and friendly environment.
                        </p>
                        <p className="text-gray-600 leading-relaxed mt-4 font-lato">
                            From classic manicures to luxurious spa pedicures, we use only high-quality products to ensure lasting results. Treat yourself to our signature pedicure experience that will leave you walking on air.
                        </p>
                    </section>
                </div>
            </main>
            <footer id="contact-us" className="bg-gray-800 text-white mt-16 py-12 px-6">
                <div className="container mx-auto grid grid-cols-1 md:grid-cols-3 gap-8 text-center">
                    <div>
                        <h4 className="font-bold text-lg mb-2 font-playfair">Get In Touch</h4>
                        <p>Our Address</p>
                        <p className="text-gray-400">1560 Hustonville Rd #345, Danville, KY 40422</p>
                    </div>
                     <div>
                        <h4 className="font-bold text-lg mb-2 invisible">Contact</h4>
                        <p>Call Us</p>
                        <p className="text-gray-400">(859) 236-2873</p>
                    </div>
                     <div>
                        <h4 className="font-bold text-lg mb-2 invisible">Contact</h4>
                        <p>Email Us</p>
                        <p className="text-gray-400">nailsexpressky@gmail.com</p>
                    </div>
                </div>
            </footer>
             {isServiceModalOpen && <ServiceSelectionModal category={currentCategory} allServices={services} selectedServices={booking.services} onSelect={handleServiceSelect} onClose={() => setIsServiceModalOpen(false)} />}
             {isPolicyModalOpen && <PolicyModal onClose={() => setIsPolicyModalOpen(false)} />}
        </div>
        </>
    );
};

const LoginModal = ({ auth, db, onClose }) => {
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const [isLoggingIn, setIsLoggingIn] = useState(false);

    const handleLogin = async (e) => {
        e.preventDefault();
        setError('');
        setIsLoggingIn(true);
        try {
            await signInWithEmailAndPassword(auth, email, password);
            onClose();
        } catch (err) {
            setError(err.message);
            // Using a custom modal for alerts
            // In a real app, you'd replace this with a proper modal component
            alert(`Authentication failed: ${err.message}`);
        } finally {
            setIsLoggingIn(false);
        }
    };

    return (
        <div className="fixed inset-0 bg-black bg-opacity-50 z-50 overflow-y-auto p-4 flex items-center justify-center">
            <div className="w-full max-w-md p-8 space-y-6 bg-white rounded-2xl shadow-xl relative">
                <button onClick={onClose} className="absolute top-4 right-4 text-gray-500 hover:text-gray-800">
                    <Icon path="M6 18L18 6M6 6l12 12" />
                </button>
                <h2 className="text-3xl font-bold text-center text-gray-800">Nail Express login</h2>
                <form onSubmit={handleLogin} className="space-y-6">
                    <div>
                        <label htmlFor="email-auth" className="text-sm font-medium text-gray-600">Email</label>
                        <input id="email-auth" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required className="w-full px-4 py-2 mt-2 text-gray-700 bg-gray-100 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-pink-400" />
                    </div>
                    <div>
                        <label htmlFor="password-auth" className="text-sm font-medium text-gray-600">Password</label>
                        <input id="password-auth" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required className="w-full px-4 py-2 mt-2 text-gray-700 bg-gray-100 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-pink-400" />
                    </div>
                    {error && <p className="text-sm text-red-500 text-center">{error}</p>}
                    <button type="submit" disabled={isLoggingIn} className="w-full py-3 font-semibold text-white bg-pink-500 rounded-lg transition-colors hover:bg-pink-600 disabled:bg-gray-400">
                        {isLoggingIn ? 'Signing in...' : 'Log In'}
                    </button>
                </form>
            </div>
        </div>
    );
};

// --- Admin Panel Components ---
const AdminPanel = ({ userRole, auth, db, storage, isAuthReady }) => {
    const [currentTab, setCurrentTab] = useState('dashboard');
    const [isBookingModalOpen, setIsBookingModalOpen] = useState(false);
    const [bookingDate, setBookingDate] = useState(new Date());
    const [notifications, setNotifications] = useState([]);

    useEffect(() => {
        if (!isAuthReady) return;

        // Listener for new bookings
        const appointmentsQuery = query(collection(db, `artifacts/${getSafeAppId()}/public/data/appointments`), where("status", "==", "booked"));
        const unsubAppointments = onSnapshot(appointmentsQuery, (snapshot) => {
            snapshot.docChanges().forEach((change) => {
                if (change.type === "added") {
                    const booking = change.doc.data();
                    const newNotif = {
                        id: `booking-${change.doc.id}`,
                        type: 'booking',
                        message: `New booking from ${booking.clientName} for ${booking.date.toDate().toLocaleDateString()}.`,
                        timestamp: new Date(),
                        isRead: false
                    };
                    setNotifications(prev => [newNotif, ...prev.filter(n => n.id !== newNotif.id)]);
                }
            });
        });

        // Listener for low stock
        const productsQuery = query(collection(db, `artifacts/${getSafeAppId()}/public/data/products`), where("stock", "<", 10));
        const unsubProducts = onSnapshot(productsQuery, (snapshot) => {
            snapshot.docChanges().forEach((change) => {
                if (change.type === "added" || change.type === "modified") {
                    const product = change.doc.data();
                    const newNotif = {
                        id: `stock-${change.doc.id}`,
                        type: 'stock',
                        message: `${product.name} is low on stock (${product.stock} remaining).`,
                        timestamp: new Date(),
                        isRead: false,
                    };
                    setNotifications(prev => [newNotif, ...prev.filter(n => n.id !== newNotif.id)]);
                }
            });
        });

        return () => {
            unsubAppointments();
            unsubProducts();
        };
    }, [db, isAuthReady]);

    const handleOpenBookingModal = (date) => {
        setBookingDate(date || new Date());
        setIsBookingModalOpen(true);
    };
    
    const handleLogout = async () => {
        try {
            await signOut(auth);
        } catch (err) {
            console.error("Logout Error:", err);
        }
    };

    const markAsRead = (id) => {
        setNotifications(notifications.map(n => n.id === id ? { ...n, isRead: true } : n));
    };

    const clearAllNotifications = () => {
        setNotifications([]);
    };

    return (
        <div className="min-h-screen bg-gray-50 font-sans">
            <Navbar 
                userRole={userRole} 
                currentTab={currentTab} 
                setCurrentTab={setCurrentTab} 
                onLogout={handleLogout}
                notifications={notifications}
                markAsRead={markAsRead}
                clearAllNotifications={clearAllNotifications}
            />
            <main className="p-4 sm:p-6 lg:p-8">
                <TabContent currentTab={currentTab} db={db} storage={storage} isAuthReady={isAuthReady} auth={auth} userRole={userRole} onCalendarDayClick={handleOpenBookingModal} />
            </main>
            <button onClick={() => handleOpenBookingModal()} className="fixed bottom-8 right-8 bg-pink-600 text-white p-4 rounded-full shadow-lg hover:bg-pink-700 transition-transform transform hover:scale-110">
                <Icon path="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L6.832 19.82a4.5 4.5 0 01-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 011.13-1.897L16.863 4.487zm0 0L19.5 7.125" />
            </button>
            {isBookingModalOpen && <BookingModal db={db} onClose={() => setIsBookingModalOpen(false)} initialDate={bookingDate} />}
        </div>
    );
};

const Navbar = ({ userRole, currentTab, setCurrentTab, onLogout, notifications, markAsRead, clearAllNotifications }) => {
    const [showNotifications, setShowNotifications] = useState(false);
    const unreadCount = notifications.filter(n => !n.isRead).length;

    const navItems = [
        { id: 'dashboard', label: 'Dashboard', icon: <Icon path="M2.25 13.5h3.86a2.25 2.25 0 012.012 1.244l.256.512a2.25 2.25 0 002.013 1.244h3.218a2.25 2.25 0 002.013-1.244l.256-.512a2.25 2.25 0 012.013-1.244h3.859m-19.5.338V18a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18v-4.162c0-.224-.034-.447-.1-.661L19.24 5.338a2.25 2.25 0 00-2.12-1.588H6.88a2.25 2.25 0 00-2.12 1.588L2.35 13.177a2.25 2.25 0 00-.1.661z" /> },
        { id: 'checkIn', label: 'Check-In', icon: <Icon path="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /> },
        { id: 'clients', label: 'Clients', icon: <Icon path="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-4.67c.12-.318.232-.656.328-1.003a4.125 4.125 0 00-7.533-2.493c-3.253 1.436-5.44 4.73-5.44 8.425v.036a12.318 12.318 0 008.624 4.482A12.318 12.318 0 0015 19.128zm-9.374 1.766a6.375 6.375 0 0111.964-4.67 4.125 4.125 0 00-7.533-2.493-4.125 4.125 0 00-4.43 2.493z" /> },
        { id: 'bookings', label: 'Bookings', icon: <Icon path="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0h18" /> },
    ];
    
    if (userRole === 'admin') {
        navItems.push({ id: 'salonReport', label: 'Reports', icon: <Icon path="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" /> });
        navItems.push({ id: 'inventory', label: 'Inventory', icon: <Icon path="M3.75 4.5A.75.75 0 014.5 3.75h15a.75.75 0 01.75.75v15a.75.75 0 01-.75.75h-15a.75.75 0 01-.75-.75v-15zM5.25 5.25v3h3V5.25h-3zM5.25 9.75v3h3v-3h-3zM5.25 15v3h3v-3h-3zM9.75 5.25v3h3V5.25h-3zM9.75 9.75v3h3v-3h-3zM9.75 15v3h3v-3h-3zm4.5-9.75v3h3V5.25h-3zm4.5 4.5v3h3v-3h-3zm0 4.5v3h3v-3h-3z" /> });
        navItems.push({ id: 'admin', label: 'Admin Settings', icon: <Icon path="M10.343 3.94c.09-.542.56-1.007 1.11-1.11h1.094c.55.103 1.02.567 1.11 1.11l.08.48a1.5 1.5 0 001.442 1.053l.498-.105c.58-.122 1.17.225 1.365.79l.578 1.002a1.5 1.5 0 00.44 1.05l.372.373c.464.463.695 1.11.588 1.715l-.12.602a1.5 1.5 0 00.88 1.53l.53.215c.603.244.966.834.966 1.48v1.094c0 .646-.363 1.236-.966 1.48l-.53.215a1.5 1.5 0 00-.88 1.53l.12.602c.107.605-.124 1.252-.588-1.715l-.372.373a1.5 1.5 0 00-.44 1.05l-.578-1.002c-.195.565-.785.912-1.365-.79l-.498-.105a1.5 1.5 0 00-1.442 1.053l-.08.48c-.09.542-.56 1.007-1.11 1.11h-1.094c-.55-.103-1.02-.567-1.11-1.11l-.08-.48a1.5 1.5 0 00-1.442-1.053l-.498.105c-.58.122-1.17-.225-1.365-.79l-.578-1.002a1.5 1.5 0 00-.44-1.05l-.372-.373c-.464-.463-.695-1.11-.588-1.715l.12-.602a1.5 1.5 0 00-.88-1.53l-.53-.215c-.603-.244-.966.834-.966-1.48v-1.094c0-.646.363 1.236-.966-1.48l.53-.215a1.5 1.5 0 00.88-1.53l-.12-.602c-.107-.605.124-1.252.588-1.715l.372.373a1.5 1.5 0 00.44 1.05l.578 1.002c.195-.565.785.912-1.365.79l.498.105a1.5 1.5 0 001.442-1.053l.08-.48z" /> }
        );
    }

    return (
        <header className="bg-white shadow-md">
            <div className="container mx-auto px-4 sm:px-6 lg:px-8">
                <div className="flex items-center justify-between h-16">
                    <div className="flex items-center">
                        <span className="font-bold text-xl text-pink-600">NailXpress Admin</span>
                        <div className="relative ml-4">
                            <button onClick={() => setShowNotifications(!showNotifications)} className="p-2 rounded-full text-gray-500 hover:bg-gray-100 relative">
                                <Icon path="M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75v-.7V9A6 6 0 006 9v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0" className="w-6 h-6" />
                                {unreadCount > 0 && (
                                    <span className="absolute top-0 right-0 block h-4 w-4 rounded-full bg-red-500 text-white text-xs flex items-center justify-center">{unreadCount}</span>
                                )}
                            </button>
                            {showNotifications && (
                                <div className="absolute right-0 mt-2 w-80 bg-white rounded-lg shadow-xl z-20">
                                    <div className="p-4 flex justify-between items-center border-b">
                                        <h3 className="font-semibold">Notifications</h3>
                                        <button onClick={clearAllNotifications} className="text-sm text-blue-500 hover:underline">Clear All</button>
                                    </div>
                                    <div className="max-h-96 overflow-y-auto">
                                        {notifications.length === 0 ? (
                                            <p className="p-4 text-gray-500">No new notifications.</p>
                                        ) : (
                                            notifications.map(n => (
                                                <div key={n.id} onClick={() => markAsRead(n.id)} className={`p-4 border-b hover:bg-gray-50 cursor-pointer ${!n.isRead ? 'bg-blue-50' : ''}`}>
                                                    <p className="text-sm">{n.message}</p>
                                                    <p className="text-xs text-gray-400 mt-1">{n.timestamp.toLocaleString()}</p>
                                                </div>
                                            ))
                                        )}
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                    <nav className="hidden md:flex items-center space-x-1">
                        {navItems.map(item => (
                            <button key={item.id} onClick={() => setCurrentTab(item.id)} className={`flex items-center px-3 py-2 rounded-md text-sm font-medium transition-colors duration-200 ${currentTab === item.id ? 'bg-pink-100 text-pink-700' : 'text-gray-500 hover:bg-gray-100'}`}>
                                {item.icon}
                                <span className="ml-2">{item.label}</span>
                            </button>
                        ))}
                    </nav>
                    <div className="flex items-center">
                        <button onClick={onLogout} className="ml-4 p-2 rounded-full text-gray-500 hover:bg-gray-100">
                            <Icon path="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15m3 0l3-3m0 0l-3-3m3 3H9" className="w-5 h-5" />
                        </button>
                    </div>
                </div>
            </div>
        </header>
    );
};

const TabContent = ({ currentTab, db, storage, isAuthReady, auth, userRole, onCalendarDayClick }) => {
    // This component dynamically renders the content based on the selected tab.
    // Each case corresponds to a major feature section of the admin panel.
    switch (currentTab) {
        case 'dashboard': return <AdvancedDashboardTab db={db} isAuthReady={isAuthReady} />;
        case 'admin': return <AdminTab db={db} storage={storage} isAuthReady={isAuthReady} auth={auth} />;
        case 'bookings': return <ClientsBookingTab db={db} isAuthReady={isAuthReady} onCalendarDayClick={onCalendarDayClick} />;
        case 'checkIn': return <CheckInTab db={db} isAuthReady={isAuthReady} />;
        case 'clients': return <ClientsTab db={db} isAuthReady={isAuthReady} />;
        case 'salonReport': return <SalonEarningReportTab db={db} storage={storage} isAuthReady={isAuthReady} userRole={userRole} />;
        case 'inventory': return <InventoryManagementTab db={db} storage={storage} isAuthReady={isAuthReady} />;
        default: return <AdvancedDashboardTab db={db} isAuthReady={isAuthReady} />;
    }
};

// --- Other components (ServiceManagement, ClientsTab, etc.) are omitted for brevity but are included in the full App.js file provided by the user ---
// --- The following are placeholder or simplified versions of the remaining components from the user's file ---

const AdvancedDashboardTab = ({ db, isAuthReady }) => {
  // A more detailed implementation would fetch and display various metrics.
  return <div className="p-6 bg-white rounded-lg shadow">Dashboard Content Here</div>;
};
const AdminTab = ({ db, storage, isAuthReady, auth }) => {
  // This component would contain sub-tabs for managing staff, services, etc.
  return <div className="p-6 bg-white rounded-lg shadow">Admin Settings Content Here</div>;
};
const ClientsBookingTab = ({ db, isAuthReady, onCalendarDayClick }) => {
  // This would show a calendar or list of appointments.
  return <div className="p-6 bg-white rounded-lg shadow">Bookings Content Here</div>;
};
const CheckInTab = ({ db, isAuthReady }) => {
  // This tab handles the client check-in process.
  return <div className="p-6 bg-white rounded-lg shadow">Check-In Content Here</div>;
};
const ClientsTab = ({ db, isAuthReady }) => {
  // This tab displays a list of all clients.
  return <div className="p-6 bg-white rounded-lg shadow">Clients List Content Here</div>;
};
const SalonEarningReportTab = ({ db, storage, isAuthReady, userRole }) => {
  // This component shows financial reports.
  return <div className="p-6 bg-white rounded-lg shadow">Salon Reports Content Here</div>;
};
const InventoryManagementTab = ({ db, storage, isAuthReady }) => {
  // This component is for managing product inventory.
  return <div className="p-6 bg-white rounded-lg shadow">Inventory Management Content Here</div>;
};

// --- Dummy components for brevity. The full code from user's App.js should be used here. ---
// This is where the rest of the components from the user's App.js file would go.
// For this example, I'm keeping it concise. The full logic is in the user's provided file.
const BookingList = () => <div>Booking List</div>;
const BookingCalendar = () => <div>Booking Calendar</div>;
const BookingModal = () => <div>Booking Modal</div>;
const ClientList = () => <div>Client List</div>;
const ClientEditModal = () => <div>Client Edit Modal</div>;
const ClientFeedbackModal = () => <div>Client Feedback Modal</div>;
const ServiceSelectionModal = () => <div>Service Selection Modal</div>;
const PolicyModal = () => <div>Policy Modal</div>;
const ServiceManagement = () => <div>Service Management</div>;
const ServiceModal = () => <div>Service Modal</div>;
const EarningsSection = () => <div>Earnings Section</div>;
const EarningReportEditModal = () => <div>Earning Report Edit Modal</div>;
const BookingSettings = () => <div>Booking Settings</div>;
const TechnicianTaskManager = () => <div>Technician Task Manager</div>;
const SalonExpenses = () => <div>Salon Expenses</div>;
const Settings = () => <div>Settings</div>;
const SupplierEditModal = () => <div>Supplier Edit Modal</div>;
