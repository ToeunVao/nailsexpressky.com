import React, { useState, useEffect, useRef, useMemo } from 'react';
import { initializeApp, deleteApp } from 'firebase/app';
import { getAuth, signInWithEmailAndPassword, onAuthStateChanged, signOut, createUserWithEmailAndPassword, signInWithCustomToken, signInAnonymously, setPersistence, browserLocalPersistence } from 'firebase/auth';
import { getFirestore, collection, doc, getDoc, onSnapshot, addDoc, updateDoc, deleteDoc, setDoc, query, where, Timestamp, writeBatch, getDocs, arrayUnion, arrayRemove } from 'firebase/firestore';
import { getStorage, ref, uploadBytesResumable, getDownloadURL, deleteObject } from 'firebase/storage';

// --- Configuration ---
// IMPORTANT: This is a sample configuration. Replace with your actual Firebase project details.
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
        <div className="text-xl font-semibold">{text}</div>
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

    useEffect(() => {
        // Load external script for Excel export
        const script = document.createElement('script');
        script.src = "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js";
        script.async = true;
        document.body.appendChild(script);

        if (!app.current) {
            try {
                app.current = initializeApp(firebaseConfig);
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

        const unsubscribe = onAuthStateChanged(auth.current, async (firebaseUser) => {
            if (firebaseUser && !firebaseUser.isAnonymous) {
                try {
                    const userDocRef = doc(db.current, 'users', firebaseUser.uid);
                    const userDocSnap = await getDoc(userDocRef);
                    if (userDocSnap.exists()) {
                        setUser(firebaseUser);
                        setUserRole(userDocSnap.data().role);
                    } else {
                        console.error("User document not found for UID:", firebaseUser.uid);
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
            setIsAuthReady(true);
        });
        
        const handleInitialAuth = async () => {
            if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) {
                try {
                    await signInWithCustomToken(auth.current, __initial_auth_token);
                } catch (error) {
                    console.error("Error with custom token:", error.message);
                    console.log("This is an expected error in this environment. Falling back to manual login.");
                    await signOut(auth.current); // Clear any invalid state
                    await signInAnonymously(auth.current); // Sign in anonymously to allow public access
                }
            } else if (auth.current && !auth.current.currentUser) {
                await signInAnonymously(auth.current);
            }
        };
        handleInitialAuth();
        
        return () => {
            unsubscribe();
            if(document.body.contains(script)){
                 document.body.removeChild(script);
            }
        };
    }, []);

    if (loading || !isAuthReady) {
        return <LoadingScreen />;
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
        const usersQuery = query(collection(db, 'users'), where("role", "==", "technician"));

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
            .font-playfair { font-family: 'Playfair Display', serif; }
            .font-lato { font-family: 'Lato', sans-serif; }
        `}</style>
        <div className="bg-[#FDF8F5] min-h-screen font-lato">
            <header className="bg-white shadow-md sticky top-0 z-10">
                <nav className="container mx-auto px-6 py-4 flex justify-between items-center">
                    <h1 className="text-2xl font-bold text-pink-500 font-playfair">NailXpress</h1>
                    <button onClick={onStaffLoginClick} className="flex items-center px-4 py-2 text-sm font-semibold bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300">
                        <Icon path="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" className="w-5 h-5 mr-2" />
                        Login
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
            <footer className="bg-gray-800 text-white mt-16 py-12 px-6">
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
            alert(`Authentication failed: ${err.message}`);
        } finally {
            setIsLoggingIn(false);
        }
    };

    return (
        <div className="fixed inset-0 bg-black bg-opacity-50 z-50 overflow-y-auto p-4">
            <div className="w-full max-w-md p-8 space-y-6 bg-white rounded-2xl shadow-xl relative mx-auto my-8">
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
    const [currentTab, setCurrentTab] = useState('checkIn');
    const [isBookingModalOpen, setIsBookingModalOpen] = useState(false);
    const [bookingDate, setBookingDate] = useState(new Date());

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

    return (
        <div className="min-h-screen bg-gray-50 font-sans">
            <Navbar userRole={userRole} currentTab={currentTab} setCurrentTab={setCurrentTab} onLogout={handleLogout} />
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

const Navbar = ({ userRole, currentTab, setCurrentTab, onLogout }) => {
    const navItems = [
        { id: 'checkIn', label: 'Check-In', icon: <Icon path="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /> },
        { id: 'clients', label: 'Clients', icon: <Icon path="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-4.67c.12-.318.232-.656.328-1.003a4.125 4.125 0 00-7.533-2.493c-3.253 1.436-5.44 4.73-5.44 8.425v.036a12.318 12.318 0 008.624 4.482A12.318 12.318 0 0015 19.128zm-9.374 1.766a6.375 6.375 0 0111.964-4.67 4.125 4.125 0 00-7.533-2.493-4.125 4.125 0 00-4.43 2.493z" /> },
        { id: 'bookings', label: 'Bookings', icon: <Icon path="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0h18" /> },
    ];
    
    if (userRole === 'admin') {
        navItems.push({ id: 'salonReport', label: 'Reports', icon: <Icon path="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" /> });
        navItems.push({ id: 'admin', label: 'Admin Settings', icon: <Icon path="M10.343 3.94c.09-.542.56-1.007 1.11-1.11h1.094c.55.103 1.02.567 1.11 1.11l.08.48a1.5 1.5 0 001.442 1.053l.498-.105c.58-.122 1.17.225 1.365.79l.578 1.002a1.5 1.5 0 00.44 1.05l.372.373c.464.463.695 1.11.588 1.715l-.12.602a1.5 1.5 0 00.88 1.53l.53.215c.603.244.966.834.966 1.48v1.094c0 .646-.363 1.236-.966 1.48l-.53.215a1.5 1.5 0 00-.88 1.53l.12.602c.107.605-.124 1.252-.588-1.715l-.372.373a1.5 1.5 0 00-.44 1.05l-.578 1.002c-.195.565-.785.912-1.365.79l-.498-.105a1.5 1.5 0 00-1.442 1.053l-.08.48c-.09.542-.56 1.007-1.11 1.11h-1.094c-.55-.103-1.02-.567-1.11-1.11l-.08-.48a1.5 1.5 0 00-1.442-1.053l-.498.105c-.58.122-1.17-.225-1.365-.79l-.578-1.002a1.5 1.5 0 00-.44-1.05l-.372-.373c-.464-.463-.695-1.11-.588-1.715l.12-.602a1.5 1.5 0 00-.88-1.53l-.53-.215c-.603-.244-.966-.834-.966-1.48v-1.094c0-.646.363-1.236.966-1.48l.53-.215a1.5 1.5 0 00.88-1.53l-.12-.602c-.107-.605.124-1.252.588-1.715l.372.373a1.5 1.5 0 00.44 1.05l.578 1.002c.195-.565.785.912-1.365.79l.498.105a1.5 1.5 0 001.442-1.053l.08-.48z" /> }
        );
    }

    return (
        <header className="bg-white shadow-md"><div className="container mx-auto px-4 sm:px-6 lg:px-8"><div className="flex items-center justify-between h-16"><div className="flex items-center"><span className="font-bold text-xl text-pink-600">NailXpress Admin</span></div><nav className="hidden md:flex items-center space-x-1">{navItems.map(item => (<button key={item.id} onClick={() => setCurrentTab(item.id)} className={`flex items-center px-3 py-2 rounded-md text-sm font-medium transition-colors duration-200 ${currentTab === item.id ? 'bg-pink-100 text-pink-700' : 'text-gray-500 hover:bg-gray-100'}`}>{item.icon}<span className="ml-2">{item.label}</span></button>))}</nav><div className="flex items-center"><button onClick={onLogout} className="ml-4 p-2 rounded-full text-gray-500 hover:bg-gray-100"><Icon path="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15m3 0l3-3m0 0l-3-3m3 3H9" className="w-5 h-5" /></button></div></div></div></header>
    );
};

const TabContent = ({ currentTab, db, storage, isAuthReady, auth, userRole, onCalendarDayClick }) => {
    switch (currentTab) {
        case 'admin': return <AdminTab db={db} storage={storage} isAuthReady={isAuthReady} auth={auth} />;
        case 'bookings': return <ClientsBookingTab db={db} isAuthReady={isAuthReady} onCalendarDayClick={onCalendarDayClick} />;
        case 'reports': return <ReportsTab db={db} isAuthReady={isAuthReady} />;
        case 'checkIn': return <CheckInTab db={db} isAuthReady={isAuthReady} />;
        case 'clients': return <ClientsTab db={db} isAuthReady={isAuthReady} />;
        case 'salonReport': return <SalonEarningReportTab db={db} storage={storage} isAuthReady={isAuthReady} userRole={userRole} />;
        default: return <CheckInTab db={db} isAuthReady={isAuthReady} />;
    }
};

const AdminTab = ({ db, storage, isAuthReady, auth }) => {
    const [adminSubTab, setAdminSubTab] = useState('staff');

    return (
        <div className="p-6 bg-white rounded-lg shadow">
            <h1 className="text-3xl font-bold text-gray-800">Admin Settings</h1>
            <div className="border-b mt-4">
                <nav className="-mb-px flex space-x-8" aria-label="Tabs">
                    <button onClick={() => setAdminSubTab('staff')} className={`whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm ${adminSubTab === 'staff' ? 'border-pink-500 text-pink-600' : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'}`}>Staff Management</button>
                    <button onClick={() => setAdminSubTab('services')} className={`whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm ${adminSubTab === 'services' ? 'border-pink-500 text-pink-600' : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'}`}>Service Management</button>
                    <button onClick={() => setAdminSubTab('booking')} className={`whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm ${adminSubTab === 'booking' ? 'border-pink-500 text-pink-600' : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'}`}>Booking Settings</button>
                    <button onClick={() => setAdminSubTab('tasks')} className={`whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm ${adminSubTab === 'tasks' ? 'border-pink-500 text-pink-600' : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'}`}>Task Manager</button>
                    <button onClick={() => setAdminSubTab('settings')} className={`whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm ${adminSubTab === 'settings' ? 'border-pink-500 text-pink-600' : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'}`}>Settings</button>
                </nav>
            </div>
            <div className="pt-6">
                {adminSubTab === 'staff' && <UserManagement db={db} />}
                {adminSubTab === 'services' && <ServiceManagement db={db} isAuthReady={isAuthReady} />}
                {adminSubTab === 'booking' && <BookingSettings db={db} />}
                {adminSubTab === 'tasks' && <TechnicianTaskManager db={db} />}
                {adminSubTab === 'settings' && <Settings db={db} />}
            </div>
        </div>
    );
};

const UserManagement = ({ db }) => {
    const [newUser, setNewUser] = useState({ name: '', phone: '', email: '', password: '', role: 'technician' });
    const [message, setMessage] = useState('');
    const [staffList, setStaffList] = useState([]);
    const [editingStaff, setEditingStaff] = useState(null);
    const [staffToDelete, setStaffToDelete] = useState(null);

    useEffect(() => {
        const unsubscribe = onSnapshot(collection(db, `users`), (snapshot) => {
            setStaffList(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
        });
        return () => unsubscribe();
    }, [db]);

    const handleCreateUser = async (e) => {
        e.preventDefault();
        setMessage('');
        if (!newUser.email || !newUser.password || !newUser.name) {
            setMessage('Please provide name, email, and password.');
            return;
        }

        const tempApp = initializeApp(firebaseConfig, 'temp-user-creation');
        const tempAuth = getAuth(tempApp);

        try {
            const userCredential = await createUserWithEmailAndPassword(tempAuth, newUser.email, newUser.password);
            const newUid = userCredential.user.uid;
            
            await setDoc(doc(db, "users", newUid), {
                name: newUser.name,
                phone: newUser.phone,
                email: newUser.email,
                role: newUser.role
            });

            setMessage(`Successfully created staff member: ${newUser.name}`);
            setNewUser({ name: '', phone: '', email: '', password: '', role: 'technician' });
        } catch (error) {
            console.error("Error creating user:", error);
            setMessage(error.message);
            alert(`Failed to create user: ${error.message}`);
        } finally {
            await deleteApp(tempApp).catch(err => console.error("Error deleting temp app", err));
        }
    };

    const handleUpdateUser = async (staffMember) => {
        const userDoc = doc(db, "users", staffMember.id);
        try {
            await updateDoc(userDoc, {
                name: staffMember.name,
                phone: staffMember.phone,
                role: staffMember.role,
                email: staffMember.email,
            });
            if(staffMember.newPassword){
                alert("Password update requires backend logic (Firebase Functions) for security and is not implemented in this client-side demo.");
            }
            setEditingStaff(null);
        } catch(error) {
            console.error("Error updating user:", error);
            alert(`Failed to update user: ${error.message}`);
        }
    };

    const confirmDeleteUser = async () => {
        if (staffToDelete) {
            try {
                await deleteDoc(doc(db, "users", staffToDelete.id));
                setMessage(`Staff member ${staffToDelete.name} removed. IMPORTANT: You must manually delete their login from the Firebase Authentication console to fully revoke access.`);
            } catch (error) {
                setMessage(`Error deleting staff: ${error.message}`);
                console.error("Error deleting user doc:", error);
                alert(`Failed to delete staff: ${error.message}`);
            } finally {
                setStaffToDelete(null);
            }
        }
    };

    return (
        <div>
            <h2 className="text-xl font-semibold text-gray-700 mb-4">Staff Management</h2>
            <form onSubmit={handleCreateUser} className="space-y-4 mb-8">
                <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
                    <input type="text" placeholder="Full Name" value={newUser.name} onChange={e => setNewUser({...newUser, name: e.target.value})} className="w-full px-3 py-2 border border-gray-300 rounded-md" required />
                    <input type="tel" placeholder="Phone Number" value={newUser.phone} onChange={e => setNewUser({...newUser, phone: e.target.value})} className="w-full px-3 py-2 border border-gray-300 rounded-md" />
                    <input type="email" placeholder="Staff Email" value={newUser.email} onChange={e => setNewUser({...newUser, email: e.target.value})} className="w-full px-3 py-2 border border-gray-300 rounded-md" required />
                    <input type="password" placeholder="Temporary Password" value={newUser.password} onChange={e => setNewUser({...newUser, password: e.target.value})} className="w-full px-3 py-2 border border-gray-300 rounded-md" required />
                    <select value={newUser.role} onChange={e => setNewUser({...newUser, role: e.target.value})} className="w-full px-3 py-2 border border-gray-300 rounded-md bg-white">
                        <option value="technician">Nail Technician</option>
                        <option value="receptionist">Receptionist</option>
                        <option value="manager">Manager</option>
                        <option value="admin">Administrator</option>
                    </select>
                </div>
                <button type="submit" className="w-auto px-6 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600">Create Staff Account</button>
            </form>
            {message && <p className="my-4 text-sm text-center text-gray-600">{message}</p>}

            <h3 className="text-lg font-semibold text-gray-700 mb-4">Staff List</h3>
            <div className="overflow-x-auto">
                <table className="min-w-full bg-white">
                    <thead className="bg-gray-50">
                        <tr>
                            <th className="py-3 px-6 text-left text-xs font-medium text-gray-500 uppercase">Name</th>
                            <th className="py-3 px-6 text-left text-xs font-medium text-gray-500 uppercase">Phone</th>
                            <th className="py-3 px-6 text-left text-xs font-medium text-gray-500 uppercase">Email</th>
                            <th className="py-3 px-6 text-left text-xs font-medium text-gray-500 uppercase">Role</th>
                            <th className="py-3 px-6 text-right text-xs font-medium text-gray-500 uppercase">Actions</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200">
                        {staffList.map(staff => (
                            <tr key={staff.id}>
                                <td className="py-4 px-6">{staff.name}</td>
                                <td className="py-4 px-6">{staff.phone}</td>
                                <td className="py-4 px-6">{staff.email}</td>
                                <td className="py-4 px-6 capitalize">{staff.role}</td>
                                <td className="py-4 px-6 text-right space-x-4">
                                    <button onClick={() => setEditingStaff(staff)} className="text-indigo-500 hover:text-indigo-700"><Icon path="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0115.75 21H5.25A2.25 2.25 0 013 18.75V8.25A2.25 2.25 0 015.25 6H10" className="w-5 h-5" /></button>
                                    <button onClick={() => setStaffToDelete(staff)} className="text-red-500 hover:text-red-700"><Icon path="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.134-2.09-2.134H8.09a2.09 2.09 0 00-2.09 2.134v.916m7.5 0a48.667 48.667 0 00-7.5 0" className="w-5 h-5" /></button>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
            {editingStaff && <StaffEditModal staff={editingStaff} onSave={handleUpdateUser} onClose={() => setEditingStaff(null)} />}
            {staffToDelete && (
                <div className="fixed inset-0 bg-black bg-opacity-50 z-50 overflow-y-auto p-4">
                    <div className="bg-white p-6 rounded-lg shadow-xl w-full max-w-md mx-auto my-8">
                        <h3 className="text-lg font-medium text-gray-900 mb-2">Confirm Deletion</h3>
                        <p className="text-sm text-gray-600 mb-4">Are you sure you want to delete {staffToDelete.name}? This action only removes them from the app list.</p>
                        <p className="text-xs text-red-600 mb-4">To fully revoke access, you must also delete the user from the Firebase Authentication console.</p>
                        <div className="flex justify-end space-x-3">
                            <button onClick={() => setStaffToDelete(null)} className="px-4 py-2 bg-gray-200 text-gray-800 rounded-md hover:bg-gray-300">Cancel</button>
                            <button onClick={confirmDeleteUser} className="px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700">Delete</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

const StaffEditModal = ({ staff, onSave, onClose }) => {
    const [editedStaff, setEditedStaff] = useState({...staff, newPassword: ''});

    useEffect(() => {
        setEditedStaff({...staff, newPassword: ''});
    }, [staff]);

    const handleSave = () => {
        onSave(editedStaff);
    };

    return (
        <div className="fixed inset-0 bg-black bg-opacity-50 z-50 overflow-y-auto p-4">
            <div className="bg-white p-6 rounded-lg shadow-xl w-full max-w-md mx-auto my-8">
                <h3 className="text-lg font-medium text-gray-900 mb-4">Edit Staff Member</h3>
                <div className="space-y-4">
                    <input type="text" placeholder="Full Name" value={editedStaff.name} onChange={e => setEditedStaff({...editedStaff, name: e.target.value})} className="w-full px-3 py-2 border border-gray-300 rounded-md" />
                    <input type="tel" placeholder="Phone Number" value={editedStaff.phone} onChange={e => setEditedStaff({...editedStaff, phone: e.target.value})} className="w-full px-3 py-2 border border-gray-300 rounded-md" />
                     <input type="email" placeholder="Email" value={editedStaff.email} onChange={e => setEditedStaff({...editedStaff, email: e.target.value})} className="w-full px-3 py-2 border border-gray-300 rounded-md bg-gray-100" readOnly/>
                     <p className="text-xs text-gray-500 -mt-2">Email cannot be changed from the app for security reasons.</p>
                    <input type="password" placeholder="New Password (leave blank to keep unchanged)" value={editedStaff.newPassword} onChange={e => setEditedStaff({...editedStaff, newPassword: e.target.value})} className="w-full px-3 py-2 border border-gray-300 rounded-md" />
                    <select value={editedStaff.role} onChange={e => setEditedStaff({...editedStaff, role: e.target.value})} className="w-full px-3 py-2 border border-gray-300 rounded-md bg-white">
                        <option value="technician">Nail Technician</option>
                        <option value="receptionist">Receptionist</option>
                        <option value="manager">Manager</option>
                        <option value="admin">Administrator</option>
                    </select>
                </div>
                <div className="mt-6 flex justify-end space-x-3">
                    <button onClick={onClose} className="w-auto px-4 py-2 bg-gray-200 text-gray-800 rounded-md hover:bg-gray-300">Cancel</button>
                    <button onClick={handleSave} className="w-auto px-4 py-2 bg-blue-500 text-white rounded-md hover:bg-blue-600">Save Changes</button>
                </div>
            </div>
        </div>
    );
};


const ReportsTab = ({ db, isAuthReady }) => {
    const [stats, setStats] = useState({ appointments: 0, services: 0, clients: 0 });
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        if (!isAuthReady) return;
        const unsubAppointments = onSnapshot(collection(db, `artifacts/${getSafeAppId()}/public/data/appointments`), (snap) => setStats(prev => ({ ...prev, appointments: snap.size })));
        const unsubServices = onSnapshot(collection(db, `artifacts/${getSafeAppId()}/public/data/services`), (snap) => setStats(prev => ({ ...prev, services: snap.size })));
        const unsubClients = onSnapshot(collection(db, `artifacts/${getSafeAppId()}/public/data/clients`), (snap) => setStats(prev => ({ ...prev, clients: snap.size })));
        setIsLoading(false);
        return () => { unsubAppointments(); unsubServices(); unsubClients(); };
    }, [db, isAuthReady]);

    const StatCard = ({ title, value, icon }) => (<div className="bg-white p-6 rounded-lg shadow-lg flex items-center space-x-4"><div className="bg-pink-100 p-3 rounded-full">{icon}</div><div><p className="text-sm text-gray-500">{title}</p><p className="text-3xl font-bold text-gray-800">{isLoading ? '...' : value}</p></div></div>);

    return (<div className="space-y-6"><h1 className="text-3xl font-bold text-gray-800">Dashboard</h1><div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6"><StatCard title="Total Appointments" value={stats.appointments} icon={<Icon path="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0h18" className="text-pink-600" />} /><StatCard title="Services Offered" value={stats.services} icon={<Icon path="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25" className="text-pink-600" />} /><StatCard title="Total Clients Checked In" value={stats.clients} icon={<Icon path="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" className="text-pink-600" />} /></div></div>);
};

const ClientsBookingTab = ({ db, isAuthReady, onCalendarDayClick }) => {
    const [view, setView] = useState('month'); // 'list', 'day', '3days', 'week', 'month'
    const [technicians, setTechnicians] = useState([]);
    const [selectedTechnician, setSelectedTechnician] = useState('All');

    useEffect(() => {
        if (!isAuthReady) return;
        const q = query(collection(db, `users`), where("role", "==", "technician"));
        const unsubscribe = onSnapshot(q, (snapshot) => {
            const staff = snapshot.docs.map(doc => doc.data().name || doc.data().email).filter(Boolean);
            setTechnicians(staff);
        }, console.error);
        return () => unsubscribe();
    }, [db, isAuthReady]);
    
    const viewOptions = [
        { id: 'list', label: 'List' },
        { id: 'day', label: 'Day' },
        { id: '3days', label: '3 Days' },
        { id: 'week', label: 'Week' },
        { id: 'month', label: 'Month' }
    ];

    return (
        <div className="p-6 bg-white rounded-lg shadow">
            <div className="flex flex-wrap justify-between items-center mb-4 gap-4">
                <h2 className="text-xl font-semibold text-gray-700">Bookings</h2>
                 <div className="flex flex-wrap items-center gap-2">
                    <button 
                        onClick={() => setSelectedTechnician('All')}
                        className={`px-3 py-1 text-sm rounded-full transition-colors ${selectedTechnician === 'All' ? 'bg-pink-600 text-white shadow' : 'bg-gray-200 text-gray-700 hover:bg-gray-300'}`}>
                        All
                    </button>
                    {technicians.map(tech => (
                        <button 
                            key={tech} 
                            onClick={() => setSelectedTechnician(tech)}
                            className={`px-3 py-1 text-sm rounded-full transition-colors ${selectedTechnician === tech ? 'bg-pink-600 text-white shadow' : 'bg-gray-200 text-gray-700 hover:bg-gray-300'}`}>
                            {tech}
                        </button>
                    ))}
                </div>
                <div className="flex items-center border border-gray-300 rounded-lg">
                    {viewOptions.map(opt => (
                         <button key={opt.id} onClick={() => setView(opt.id)} className={`px-3 py-1 text-sm font-medium ${view === opt.id ? 'bg-pink-600 text-white' : 'bg-white text-gray-600'} first:rounded-l-lg last:rounded-r-lg hover:bg-pink-50`}>{opt.label}</button>
                    ))}
                </div>
            </div>
            
            {view === 'list' ? 
                <BookingList db={db} isAuthReady={isAuthReady} selectedTechnician={selectedTechnician} /> : 
                <BookingCalendar db={db} isAuthReady={isAuthReady} onDayClick={onCalendarDayClick} selectedTechnician={selectedTechnician} view={view}/>
            }
        </div>
    );
};

const BookingList = ({ db, isAuthReady, selectedTechnician }) => {
    const [appointments, setAppointments] = useState([]);
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        if (!isAuthReady) return;
        const q = query(collection(db, `artifacts/${getSafeAppId()}/public/data/appointments`));
        const unsubscribe = onSnapshot(q, (snapshot) => {
            const apptsData = snapshot.docs.map(doc => ({ 
                id: doc.id, 
                ...doc.data(), 
                date: doc.data().date?.toDate ? doc.data().date.toDate().toLocaleString() : 'N/A' 
            }));
            setAppointments(apptsData);
            setIsLoading(false);
        }, console.error);
        return () => unsubscribe();
    }, [db, isAuthReady]);

    const filteredAppointments = useMemo(() => {
        if (selectedTechnician === 'All') {
            return appointments;
        }
        return appointments.filter(appt => appt.technician === selectedTechnician);
    }, [appointments, selectedTechnician]);

    const handleDeleteBooking = async (id) => {
        if (window.confirm("Are you sure you want to delete this appointment?")) {
            await deleteDoc(doc(db, `artifacts/${getSafeAppId()}/public/data/appointments`, id));
        }
    };

    return (<div>{isLoading ? <p>Loading...</p> : (<div className="overflow-x-auto"><table className="min-w-full bg-white"><thead className="bg-gray-50"><tr><th className="py-3 px-6 text-left text-xs font-medium text-gray-500 uppercase">Client</th><th className="py-3 px-6 text-left text-xs font-medium text-gray-500 uppercase">Services</th><th className="py-3 px-6 text-left text-xs font-medium text-gray-500 uppercase">Date & Time</th><th className="py-3 px-6 text-left text-xs font-medium text-gray-500 uppercase">Technician</th><th className="py-3 px-6 text-right text-xs font-medium text-gray-500 uppercase">Action</th></tr></thead><tbody className="divide-y divide-gray-200">{filteredAppointments.map(appt => (<tr key={appt.id}><td className="py-4 px-6">{appt.clientName}</td><td className="py-4 px-6">{Array.isArray(appt.services) ? appt.services.join(', ') : ''}</td><td className="py-4 px-6">{appt.date}</td><td className="py-4 px-6">{appt.technician}</td><td className="py-4 px-6 text-right"><button onClick={() => handleDeleteBooking(appt.id)} className="text-red-500 hover:text-red-700"><Icon path="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.134-2.09-2.134H8.09a2.09 2.09 0 00-2.09 2.134v.916m7.5 0a48.667 48.667 0 00-7.5 0" className="w-5 h-5" /></button></td></tr>))}</tbody></table></div>)}</div>);
};

const BookingCalendar = ({ db, isAuthReady, onDayClick, selectedTechnician, view }) => {
    const [currentDate, setCurrentDate] = useState(new Date());
    const [appointments, setAppointments] = useState([]);
    
    useEffect(() => {
        if (!isAuthReady) return;
        const q = query(collection(db, `artifacts/${getSafeAppId()}/public/data/appointments`));
        const unsubscribe = onSnapshot(q, (snapshot) => {
            setAppointments(snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id, date: doc.data().date.toDate() })));
        }, console.error);
        return () => unsubscribe();
    }, [db, isAuthReady]);

    const getDaysForView = () => {
        const days = [];
        const start = new Date(currentDate);
        switch(view) {
            case 'day':
                days.push(start);
                break;
            case '3days':
                days.push(start);
                days.push(new Date(new Date().setDate(start.getDate() + 1)));
                days.push(new Date(new Date().setDate(start.getDate() + 2)));
                break;
            case 'week':
                start.setDate(start.getDate() - start.getDay());
                for (let i = 0; i < 7; i++) {
                    days.push(new Date(start));
                    start.setDate(start.getDate() + 1);
                }
                break;
            case 'month':
            default:
                const startOfMonth = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1);
                const endOfMonth = new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 0);
                const startDate = new Date(startOfMonth);
                startDate.setDate(startDate.getDate() - startDate.getDay());
                 while(days.length < 42) {
                    days.push(new Date(startDate));
                    startDate.setDate(startDate.getDate() + 1);
                }
        }
        return days;
    };
    
    const days = getDaysForView();

    const prev = () => {
        const newDate = new Date(currentDate);
        switch(view) {
            case 'day': newDate.setDate(newDate.getDate() - 1); break;
            case '3days': newDate.setDate(newDate.getDate() - 3); break;
            case 'week': newDate.setDate(newDate.getDate() - 7); break;
            case 'month': newDate.setMonth(newDate.getMonth() - 1); break;
            default: break;
        }
        setCurrentDate(newDate);
    };
    const next = () => {
        const newDate = new Date(currentDate);
        switch(view) {
            case 'day': newDate.setDate(newDate.getDate() + 1); break;
            case '3days': newDate.setDate(newDate.getDate() + 3); break;
            case 'week': newDate.setDate(newDate.getDate() + 7); break;
            case 'month': newDate.setMonth(newDate.getMonth() + 1); break;
            default: break;
        }
        setCurrentDate(newDate);
    };

    const getHeaderTitle = () => {
        switch(view) {
            case 'day': return currentDate.toLocaleDateString('default', { weekday: 'long', month: 'long', day: 'numeric' });
            case '3days': return `3 Day View`;
            case 'week': return `Week of ${currentDate.toLocaleDateString('default', { month: 'long', day: 'numeric' })}`;
            case 'month': return currentDate.toLocaleString('default', { month: 'long', year: 'numeric' });
            default: return '';
        }
    };

    return (
        <div>
            <div className="flex justify-between items-center mb-4">
                <button onClick={prev} className="p-2 rounded-full hover:bg-gray-100"><Icon path="M15.75 19.5L8.25 12l7.5-7.5" /></button>
                <h3 className="text-lg font-semibold">{getHeaderTitle()}</h3>
                <button onClick={next} className="p-2 rounded-full hover:bg-gray-100"><Icon path="M8.25 4.5l7.5 7.5-7.5 7.5" /></button>
            </div>
            <div className={`grid gap-1 text-center ${view === 'month' ? 'grid-cols-7' : 'grid-cols-1'}`}>
                 {view === 'month' && ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(day => <div key={day} className="font-bold text-xs text-gray-500 py-2">{day}</div>)}
                {days.map((day, index) => {
                    const isCurrentMonth = day.getMonth() === currentDate.getMonth();
                    const appointmentsForDay = appointments
                        .filter(a => a.date.toDateString() === day.toDateString() && (selectedTechnician === 'All' || a.technician === selectedTechnician))
                        .sort((a,b) => a.date - b.date);

                    return (
                        <div key={index} onClick={() => onDayClick(day)} className={`p-2 border rounded-md cursor-pointer flex flex-col hover:bg-pink-50 transition-colors ${view === 'month' ? 'h-28' : 'min-h-48'} ${isCurrentMonth || view !== 'month' ? 'bg-white' : 'bg-gray-50 text-gray-400'}`}>
                            <span className="font-medium">{view === 'month' ? day.getDate() : day.toLocaleDateString('default', { weekday: 'short', month: 'short', day: 'numeric' })}</span>
                            <div className="text-xs mt-1 overflow-y-auto space-y-1">
                                {appointmentsForDay.map(a => (
                                    <div key={a.id} className="bg-pink-100 text-pink-800 rounded px-1 py-0.5 text-left">
                                        <p className="font-semibold truncate">{a.clientName}</p>
                                        <p>{a.date.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</p>
                                    </div>
                                ))}
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
};

const BookingModal = ({ db, onClose, initialDate }) => {
    const [booking, setBooking] = useState({
        clientName: '', phone: '', groupSize: 1, bookingType: 'Booked - Calendar',
        services: [], technician: 'Any', date: initialDate.toISOString().slice(0, 16), notes: ''
    });
    const [agreedToPolicy, setAgreedToPolicy] = useState(true);
    const [message, setMessage] = useState('');
    const [technicians, setTechnicians] = useState([]);
    const [allServices, setAllServices] = useState([]);
    
    useEffect(() => {
        const usersQuery = query(collection(db, 'users'), where("role", "==", "technician"));
        const unsubUsers = onSnapshot(usersQuery, snap => setTechnicians(['Any', ...snap.docs.map(d => d.data().name || d.data().email)]));
        const unsubServices = onSnapshot(collection(db, `artifacts/${getSafeAppId()}/public/data/services`), snap => setAllServices(snap.docs.map(d => ({id: d.id, ...d.data()}))));
        return () => { unsubUsers(); unsubServices(); };
    }, [db]);

    const handleSave = async (e) => {
        e.preventDefault();
        if (!booking.clientName || !booking.phone) {
            setMessage("Client name and phone are required.");
            return;
        }
        try {
            const appointmentsCollection = collection(db, `artifacts/${getSafeAppId()}/public/data/appointments`);
            await addDoc(appointmentsCollection, {
                ...booking,
                date: Timestamp.fromDate(new Date(booking.date)),
                status: 'booked'
            });
            onClose();
        } catch (error) {
            console.error("Error creating appointment:", error);
            setMessage("Failed to save appointment.");
            alert(`Failed to save appointment: ${error.message}`);
        }
    };

    return (
        <div className="fixed inset-0 bg-black bg-opacity-50 z-50 overflow-y-auto p-4">
            <div className="bg-white p-6 rounded-lg shadow-xl w-full max-w-2xl mx-auto my-8">
                <h3 className="text-2xl font-bold text-gray-800 mb-6">Add New Appointment</h3>
                <form onSubmit={handleSave} className="space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                            <label className="block text-sm font-medium text-gray-700">Client Name</label>
                            <input type="text" placeholder="Client Name" value={booking.clientName} onChange={e => setBooking({...booking, clientName: e.target.value})} className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-md" required />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700">Phone</label>
                            <input type="tel" placeholder="Phone" value={booking.phone} onChange={e => setBooking({...booking, phone: e.target.value})} className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-md" required />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700">Group Size</label>
                            <select value={booking.groupSize} onChange={e => setBooking({...booking, groupSize: e.target.value})} className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-md bg-white">
                                {[...Array(10).keys()].map(i => <option key={i+1} value={i+1}>{i+1}</option>)}
                            </select>
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700">Booking Type</label>
                            <select value={booking.bookingType} onChange={e => setBooking({...booking, bookingType: e.target.value})} className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-md bg-white">
                                <option>Booked - Calendar</option>
                                <option>Walk-in</option>
                                <option>Phone</option>
                            </select>
                        </div>
                        <div className="md:col-span-2">
                             <label className="block text-sm font-medium text-gray-700">Services</label>
                            <select multiple value={booking.services} onChange={e => setBooking({...booking, services: [...e.target.selectedOptions].map(o => o.value)})} className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-md bg-white h-24">
                                {allServices.map(s => <option key={s.id} value={s.name}>{s.name}</option>)}
                            </select>
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700">Technician</label>
                            <select value={booking.technician} onChange={e => setBooking({...booking, technician: e.target.value})} className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-md bg-white">
                                {technicians.map(t => <option key={t} value={t}>{t}</option>)}
                            </select>
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700">Date & Time</label>
                            <input type="datetime-local" value={booking.date} onChange={e => setBooking({...booking, date: e.target.value})} className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-md" />
                        </div>
                        <div className="md:col-span-2">
                            <label className="block text-sm font-medium text-gray-700">Notes</label>
                            <textarea placeholder="Notes" value={booking.notes} onChange={e => setBooking({...booking, notes: e.target.value})} className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-md h-20"></textarea>
                        </div>
                    </div>
                    <div className="flex items-center justify-center pt-4">
                        <input id="policy-agree-booking" type="checkbox" checked={agreedToPolicy} onChange={(e) => setAgreedToPolicy(e.target.checked)} className="h-4 w-4 text-pink-600 focus:ring-pink-500 border-gray-300 rounded" />
                        <label htmlFor="policy-agree-booking" className="ml-2 block text-sm text-gray-900">I agree to the <button type="button" className="font-medium text-pink-600 hover:underline">Salon Policy</button>.</label>
                    </div>
                    {message && <p className="text-sm text-red-500 text-center">{message}</p>}
                    <div className="flex justify-end space-x-3 pt-4">
                        <button type="button" onClick={onClose} className="w-auto px-6 py-2 bg-gray-200 text-gray-800 rounded-md hover:bg-gray-300">Cancel</button>
                        <button type="submit" disabled={!agreedToPolicy} className="w-auto px-6 py-2 bg-pink-600 text-white rounded-md hover:bg-pink-700 disabled:bg-gray-400">Save Appointment</button>
                    </div>
                </form>
            </div>
        </div>
    );
};

const CheckInTab = ({ db, isAuthReady }) => {
    const [clients, setClients] = useState([]);
    const [isLoading, setIsLoading] = useState(true);
    const [checkInView, setCheckInView] = useState('form'); // 'form', 'queue', 'processing', 'finished'
    const [editingClient, setEditingClient] = useState(null);

    useEffect(() => {
        if (!isAuthReady) return;
        const today = new Date();
        const startOfDay = new Date(today.setHours(0, 0, 0, 0));
        const q = query(collection(db, `artifacts/${getSafeAppId()}/public/data/clients`), where("checkInTime", ">=", Timestamp.fromDate(startOfDay)));
        const unsubscribe = onSnapshot(q, (snapshot) => {
            setClients(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
            setIsLoading(false);
        }, console.error);
        return () => unsubscribe();
    }, [db, isAuthReady]);
    
    const updateClientStatus = async (id, status) => {
        const clientDoc = doc(db, `artifacts/${getSafeAppId()}/public/data/clients`, id);
        await updateDoc(clientDoc, { status });
    };

    const handleUpdateClient = async (clientData) => {
        const clientDoc = doc(db, `artifacts/${getSafeAppId()}/public/data/clients`, clientData.id);
        await updateDoc(clientDoc, clientData);
        setEditingClient(null);
    };

    const deleteClient = async (id) => {
        if (window.confirm("Are you sure you want to delete this client check-in?")) {
            await deleteDoc(doc(db, `artifacts/${getSafeAppId()}/public/data/clients`, id));
        }
    };
    
    const activeQueueClients = clients.filter(c => c.status === 'checked-in');
    const processingClients = clients.filter(c => c.status === 'processing');
    const finishedClients = clients.filter(c => c.status === 'finished');

    return (
        <div className="space-y-6">
            <div className="p-6 bg-white rounded-lg shadow">
                 <div className="flex border-b">
                    <button onClick={() => setCheckInView('form')} className={`py-2 px-4 font-semibold ${checkInView === 'form' ? 'border-b-2 border-pink-500 text-pink-600' : 'text-gray-500'}`}>Check In</button>
                    <button onClick={() => setCheckInView('queue')} className={`py-2 px-4 font-semibold ${checkInView === 'queue' ? 'border-b-2 border-pink-500 text-pink-600' : 'text-gray-500'}`}>Active Queue ({activeQueueClients.length})</button>
                    <button onClick={() => setCheckInView('processing')} className={`py-2 px-4 font-semibold ${checkInView === 'processing' ? 'border-b-2 border-pink-500 text-pink-600' : 'text-gray-500'}`}>Processing ({processingClients.length})</button>
                    <button onClick={() => setCheckInView('finished')} className={`py-2 px-4 font-semibold ${checkInView === 'finished' ? 'border-b-2 border-pink-500 text-pink-600' : 'text-gray-500'}`}>Finished Clients ({finishedClients.length})</button>
                </div>
                <div className="pt-6">
                    {checkInView === 'form' && <CheckInFormSection db={db} />}
                    {checkInView === 'queue' && <ClientList title="Active Queue" clients={activeQueueClients} updateStatus={updateClientStatus} deleteClient={deleteClient} onEdit={setEditingClient} />}
                    {checkInView === 'processing' && <ClientList title="Clients In Processing" clients={processingClients} updateStatus={updateClientStatus} deleteClient={deleteClient} onEdit={setEditingClient} />}
                    {checkInView === 'finished' && <ClientList title="Finished Clients" clients={finishedClients} updateStatus={updateClientStatus} deleteClient={deleteClient} onEdit={setEditingClient} />}
                </div>
            </div>
            {editingClient && <ClientEditModal client={editingClient} db={db} onSave={handleUpdateClient} onClose={() => setEditingClient(null)} />}
        </div>
    );
};

const CheckInFormSection = ({ db }) => {
    const [client, setClient] = useState({ name: '', phone: '', bookingType: 'Walk-in', groupSize: 1, services: [], technician: 'Any' });
    const [agreedToPolicy, setAgreedToPolicy] = useState(true);
    const [message, setMessage] = useState('');
    const [services, setServices] = useState([]);
    const [allClients, setAllClients] = useState([]);
    const [nameSuggestions, setNameSuggestions] = useState([]);
    const [phoneSuggestions, setPhoneSuggestions] = useState([]);
    const [categories, setCategories] = useState([]);
    const [isServiceModalOpen, setIsServiceModalOpen] = useState(false);
    const [isPolicyModalOpen, setIsPolicyModalOpen] = useState(false);
    const [currentCategory, setCurrentCategory] = useState('');
    const [technicians, setTechnicians] = useState([]);
    
    useEffect(() => {
        const unsubscribeServices = onSnapshot(collection(db, `artifacts/${getSafeAppId()}/public/data/services`), (snapshot) => {
            const servicesData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            setServices(servicesData);
            const uniqueCategories = [...new Set(servicesData.map(s => s.category))];
            setCategories(uniqueCategories);
        });
        const unsubscribeClients = onSnapshot(collection(db, `artifacts/${getSafeAppId()}/public/data/clients`), (snapshot) => {
            setAllClients(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
        });
        const usersQuery = query(collection(db, 'users'), where("role", "==", "technician"));
        const unsubscribeUsers = onSnapshot(usersQuery, (snapshot) => {
            const techData = snapshot.docs.map(doc => doc.data().name || doc.data().email);
            setTechnicians(['Any', ...techData]);
        });
        return () => { unsubscribeServices(); unsubscribeClients(); unsubscribeUsers(); };
    }, [db]);

    const handleNameChange = (e) => {
        const value = e.target.value;
        setClient({...client, name: value});
        if (value) {
            setNameSuggestions(allClients.filter(c => c.name.toLowerCase().includes(value.toLowerCase())));
        } else {
            setNameSuggestions([]);
        }
    };
    
    const handlePhoneChange = (e) => {
        const value = e.target.value;
        setClient({...client, phone: value});
        if (value) {
            setPhoneSuggestions(allClients.filter(c => c.phone.includes(value)));
        } else {
            setPhoneSuggestions([]);
        }
    };

    const selectClient = (selectedClient) => {
        setClient({...client, name: selectedClient.name, phone: selectedClient.phone});
        setNameSuggestions([]);
        setPhoneSuggestions([]);
    };

    const handleCheckIn = async (e) => {
        e.preventDefault();
        setMessage('');
        if (!client.name || !client.phone || client.services.length === 0) {
            setMessage('Please fill name, phone, and select at least one service.');
            return;
        }
        if (!agreedToPolicy) {
            setMessage('Please agree to the salon policy before checking in.');
            return;
        }
        try {
            const clientsCollection = collection(db, `artifacts/${getSafeAppId()}/public/data/clients`);
            await addDoc(clientsCollection, { ...client, checkInTime: Timestamp.now(), status: 'checked-in' });
            setMessage(`Client ${client.name} checked in successfully!`);
            setClient({ name: '', phone: '', bookingType: 'Walk-in', groupSize: 1, services: [], technician: 'Any' });
            setAgreedToPolicy(true);
        } catch (error) {
            setMessage(`Error checking in client: ${error.message}`);
            console.error(error);
            alert(`Failed to check in client: ${error.message}`);
        }
    };
    
    const handleServiceSelect = (serviceName) => {
        setClient(prev => {
            const newServices = prev.services.includes(serviceName) ? prev.services.filter(s => s !== serviceName) : [...prev.services, serviceName];
            return { ...prev, services: newServices };
        });
    };

    return (
        <div className="space-y-6">
             <form onSubmit={handleCheckIn}>
                <h3 className="text-lg font-semibold text-gray-700 mb-4">Your Information</h3>
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
                    <div className="relative">
                       <label htmlFor="client-name" className="block text-sm font-medium text-gray-700 mb-1">Full Name</label>
                       <input id="client-name" type="text" placeholder="Full Name" value={client.name} onChange={handleNameChange} className="w-full px-3 py-2 border border-gray-300 rounded-md" required />
                       {nameSuggestions.length > 0 && <div className="absolute z-10 w-full bg-white border rounded-md mt-1 shadow-lg max-h-40 overflow-y-auto">{nameSuggestions.map(c => <div key={c.id} onClick={() => selectClient(c)} className="p-2 hover:bg-gray-100 cursor-pointer">{c.name}</div>)}</div>}
                    </div>
                    <div className="relative">
                        <label htmlFor="client-phone" className="block text-sm font-medium text-gray-700 mb-1">Phone Number</label>
                        <input id="client-phone" type="tel" placeholder="Phone Number" value={client.phone} onChange={handlePhoneChange} className="w-full px-3 py-2 border border-gray-300 rounded-md" required />
                        {phoneSuggestions.length > 0 && <div className="absolute z-10 w-full bg-white border rounded-md mt-1 shadow-lg max-h-40 overflow-y-auto">{phoneSuggestions.map(c => <div key={c.id} onClick={() => selectClient(c)} className="p-2 hover:bg-gray-100 cursor-pointer">{c.phone} ({c.name})</div>)}</div>}
                    </div>
                    <div>
                        <label htmlFor="booking-type" className="block text-sm font-medium text-gray-700 mb-1">Booking Type</label>
                        <select id="booking-type" value={client.bookingType} onChange={e => setClient({...client, bookingType: e.target.value})} className="w-full px-3 py-2 border border-gray-300 rounded-md bg-white"><option>Walk-in</option><option>Phone</option><option>Online</option></select>
                    </div>
                    <div>
                        <label htmlFor="technician" className="block text-sm font-medium text-gray-700 mb-1">Technician</label>
                        <select id="technician" value={client.technician} onChange={e => setClient({...client, technician: e.target.value})} className="w-full px-3 py-2 border border-gray-300 rounded-md bg-white">
                            {technicians.map(t => <option key={t} value={t}>{t}</option>)}
                        </select>
                    </div>
                </div>
                <div className="flex justify-between items-center mb-4">
                    <h3 className="text-lg font-semibold text-gray-700">Select Your Services</h3>
                    <span className="text-sm font-medium text-gray-600">{client.services.length} selected</span>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-6">
                    {categories.map(cat => (<button type="button" key={cat} onClick={() => { setCurrentCategory(cat); setIsServiceModalOpen(true); }} className="p-4 border border-gray-300 rounded-lg text-center hover:bg-pink-50 hover:shadow-md transition"><p className="font-semibold text-pink-600">{cat}</p><p className="text-xs text-gray-500">Click to select</p></button>))}
                </div>
                
                <div className="mt-6 mb-4 flex items-center justify-center">
                    <input id="policy-agree" type="checkbox" checked={agreedToPolicy} onChange={(e) => setAgreedToPolicy(e.target.checked)} className="h-4 w-4 text-pink-600 focus:ring-pink-500 border-gray-300 rounded" />
                    <label htmlFor="policy-agree" className="ml-2 block text-sm text-gray-900">
                        I agree with the <button type="button" onClick={() => setIsPolicyModalOpen(true)} className="font-medium text-pink-600 hover:underline">Salon Policy</button>.
                    </label>
                </div>

                <div className="text-center">
                    <button type="submit" disabled={!agreedToPolicy} className="w-auto px-12 py-3 bg-pink-600 text-white font-bold rounded-lg hover:bg-pink-700 disabled:bg-gray-400 disabled:cursor-not-allowed">Check In</button>
                </div>
            </form>
            {message && <p className="mt-4 text-sm text-center text-gray-600">{message}</p>}
            {isServiceModalOpen && <ServiceSelectionModal category={currentCategory} allServices={services} selectedServices={client.services} onSelect={handleServiceSelect} onClose={() => setIsServiceModalOpen(false)} />}
            {isPolicyModalOpen && <PolicyModal onClose={() => setIsPolicyModalOpen(false)} />}
        </div>
    );
};

const ClientList = ({ title, clients, updateStatus, deleteClient, onEdit }) => (
    <div className="mt-8">
        <h3 className="text-xl font-semibold text-gray-700 mb-4">{title}</h3>
        {clients.length > 0 ? (
            <div className="overflow-x-auto">
                <table className="min-w-full bg-white">
                    <thead className="bg-gray-50">
                        <tr>
                            <th className="py-3 px-6 text-left text-xs font-medium text-gray-500 uppercase">Name</th>
                            <th className="py-3 px-6 text-left text-xs font-medium text-gray-500 uppercase">Phone</th>
                            <th className="py-3 px-6 text-left text-xs font-medium text-gray-500 uppercase">Services</th>
                            <th className="py-3 px-6 text-left text-xs font-medium text-gray-500 uppercase">Group</th>
                            <th className="py-3 px-6 text-left text-xs font-medium text-gray-500 uppercase">Tech</th>
                            <th className="py-3 px-6 text-right text-xs font-medium text-gray-500 uppercase">Actions</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200">
                        {clients.map(c => (
                            <tr key={c.id}>
                                <td className="py-4 px-6">{c.name}</td>
                                <td className="py-4 px-6">{c.phone}</td>
                                <td className="py-4 px-6">{c.services.join(', ')}</td>
                                <td className="py-4 px-6">{c.groupSize}</td>
                                <td className="py-4 px-6">{c.technician}</td>
                                <td className="py-4 px-6 text-right space-x-2">
                                    {c.status === 'checked-in' && <button onClick={() => updateStatus(c.id, 'processing')} className="text-blue-500 hover:text-blue-700"><Icon path="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" className="w-5 h-5" /></button>}
                                    {c.status === 'processing' && <button onClick={() => updateStatus(c.id, 'finished')} className="text-green-500 hover:text-green-700"><Icon path="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" className="w-5 h-5" /></button>}
                                    <button onClick={() => onEdit(c)} className="text-indigo-500 hover:text-indigo-700"><Icon path="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0115.75 21H5.25A2.25 2.25 0 013 18.75V8.25A2.25 2.25 0 015.25 6H10" className="w-5 h-5" /></button>
                                    <button onClick={() => deleteClient(c.id)} className="text-red-500 hover:text-red-700"><Icon path="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.134-2.09-2.134H8.09a2.09 2.09 0 00-2.09 2.134v.916m7.5 0a48.667 48.667 0 00-7.5 0" className="w-5 h-5" /></button>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        ) : <p>No clients in this list.</p>}
    </div>
);

const ClientEditModal = ({ client, db, onSave, onClose }) => {
    const [editedClient, setEditedClient] = useState({ ...client });
    const [technicians, setTechnicians] = useState([]);
    const [allServices, setAllServices] = useState([]);

    useEffect(() => {
        const usersQuery = query(collection(db, 'users'), where("role", "==", "technician"));
        const unsubUsers = onSnapshot(usersQuery, snap => setTechnicians(['Any', ...snap.docs.map(d => d.data().name || d.data().email)]));
        const unsubServices = onSnapshot(collection(db, `artifacts/${getSafeAppId()}/public/data/services`), snap => setAllServices(snap.docs.map(d => ({id: d.id, ...d.data()}))));
        return () => { unsubUsers(); unsubServices(); };
    }, [db]);

    const handleSave = () => {
        onSave(editedClient);
    };

    return (
        <div className="fixed inset-0 bg-black bg-opacity-50 z-50 overflow-y-auto p-4">
            <div className="bg-white p-6 rounded-lg shadow-xl w-full max-w-lg mx-auto my-8">
                <h3 className="text-2xl font-bold text-gray-800 mb-6">Edit Check-In</h3>
                <div className="space-y-4">
                    <input type="text" placeholder="Client Name" value={editedClient.name} onChange={e => setEditedClient({...editedClient, name: e.target.value})} className="w-full px-3 py-2 border border-gray-300 rounded-md" required />
                    <input type="tel" placeholder="Phone" value={editedClient.phone} onChange={e => setEditedClient({...editedClient, phone: e.target.value})} className="w-full px-3 py-2 border border-gray-300 rounded-md" required />
                    <select multiple value={editedClient.services} onChange={e => setEditedClient({...editedClient, services: [...e.target.selectedOptions].map(o => o.value)})} className="w-full px-3 py-2 border border-gray-300 rounded-md bg-white h-24">
                        {allServices.map(s => <option key={s.id} value={s.name}>{s.name}</option>)}
                    </select>
                    <select value={editedClient.technician} onChange={e => setEditedClient({...editedClient, technician: e.target.value})} className="w-full px-3 py-2 border border-gray-300 rounded-md bg-white">
                        {technicians.map(t => <option key={t} value={t}>{t}</option>)}
                    </select>
                </div>
                <div className="flex justify-end space-x-3 pt-4">
                    <button type="button" onClick={onClose} className="w-auto px-6 py-2 bg-gray-200 text-gray-800 rounded-md hover:bg-gray-300">Cancel</button>
                    <button type="button" onClick={handleSave} className="w-auto px-6 py-2 bg-pink-600 text-white rounded-md hover:bg-pink-700">Save Changes</button>
                </div>
            </div>
        </div>
    );
};

const ServiceSelectionModal = ({ category, allServices, selectedServices, onSelect, onClose }) => {
    const servicesInCategory = allServices.filter(s => s.category === category);
    return (
        <div className="fixed inset-0 bg-black bg-opacity-50 z-50 overflow-y-auto p-4">
            <div className="bg-white p-6 rounded-lg shadow-xl w-full max-w-lg mx-auto my-8">
                <div className="flex justify-between items-center mb-4">
                    <h3 className="text-2xl font-bold text-gray-800">{category}</h3>
                    <button onClick={onClose}><Icon path="M6 18L18 6M6 6l12 12" /></button>
                </div>
                <div className="space-y-3 max-h-96 overflow-y-auto">
                    {servicesInCategory.map(service => (
                        <label key={service.id} className="flex items-center p-3 rounded-lg hover:bg-gray-50 cursor-pointer">
                            <input type="checkbox" checked={selectedServices.includes(service.name)} onChange={() => onSelect(service.name)} className="h-5 w-5 text-pink-600 focus:ring-pink-500 border-gray-300 rounded" />
                            <span className="ml-3 font-semibold flex-grow">{service.name}</span>
                            <span>${service.price.toFixed(2)}</span>
                        </label>
                    ))}
                </div>
                <div className="flex justify-end mt-6">
                    <button onClick={onClose} className="w-auto px-6 py-2 bg-pink-600 text-white font-bold rounded-lg hover:bg-pink-700">Done</button>
                </div>
            </div>
        </div>
    );
};

const PolicyModal = ({ onClose }) => (
    <div className="fixed inset-0 bg-black bg-opacity-50 z-50 overflow-y-auto p-4">
        <div className="bg-white p-6 rounded-lg shadow-xl w-full max-w-2xl mx-auto my-8">
            <div className="flex justify-between items-center mb-4">
                <h3 className="text-2xl font-bold text-gray-800">Salon Policy</h3>
                <button onClick={onClose}><Icon path="M6 18L18 6M6 6l12 12" /></button>
            </div>
            <div className="space-y-4 text-sm text-gray-600 max-h-96 overflow-y-auto">
                <p><strong>Appointments:</strong> We encourage booking appointments in advance via phone or our online system to secure your preferred time and technician. Walk-ins are welcome but are subject to availability.</p>
                <p><strong>Cancellations & No-Shows:</strong> We understand that schedules can change. Please provide at least 24 hours' notice for any cancellations. Cancellations with less than 24 hours' notice or no-shows may be subject to a fee on your next visit.</p>
                <p><strong>Late Arrivals:</strong> To ensure our technicians have enough time to provide high-quality service, we may need to shorten your service or reschedule your appointment if you arrive more than 15 minutes late.</p>
                <p><strong>Technician Requests:</strong> You may request a specific technician when booking your appointment. We will do our best to accommodate your request, but we cannot guarantee availability.</p>
                <p><strong>Pricing and Service Adjustments:</strong> Prices for services are based on standard nail length and condition. Prices may be adjusted for extra-long nails, complex designs, or additional preparation work required. Your technician will consult with you before any price changes are made.</p>
                <p><strong>Refunds & Service Guarantee:</strong> We take pride in our work. If you are not satisfied with your service, please let us know before you leave the salon. We offer a 7-day guarantee for gel polish and acrylic services and will happily fix any issues within this period. We do not offer monetary refunds for services rendered.</p>
                <p><strong>Right to Refuse Service:</strong> For the safety and well-being of our clients and staff, we reserve the right to refuse service to anyone with a nail condition we suspect may be contagious, or for any behavior we deem inappropriate.</p>
                <p className="mt-4">Thank you for your understanding and cooperation!</p>
            </div>
            <button onClick={onClose} className="w-auto px-6 py-2 mt-6 bg-pink-600 text-white font-bold rounded-lg hover:bg-pink-700">Close</button>
        </div>
    </div>
);

const ClientsTab = ({ db, isAuthReady }) => {
    const [clients, setClients] = useState([]);
    const [appointments, setAppointments] = useState([]);
    const [isLoading, setIsLoading] = useState(true);
    const fileInputRef = useRef(null);

    useEffect(() => {
        if (!isAuthReady) return;
        let unsubClients, unsubAppointments;

        const fetchClients = () => {
            const q = query(collection(db, `artifacts/${getSafeAppId()}/public/data/clients`));
            unsubClients = onSnapshot(q, (snapshot) => {
                setClients(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
                setIsLoading(false);
            }, console.error);
        };

        const fetchAppointments = () => {
            const q = query(collection(db, `artifacts/${getSafeAppId()}/public/data/appointments`));
            unsubAppointments = onSnapshot(q, (snapshot) => {
                setAppointments(snapshot.docs.map(doc => doc.data()));
            }, console.error);
        };

        fetchClients();
        fetchAppointments();

        return () => {
            if (unsubClients) unsubClients();
            if (unsubAppointments) unsubAppointments();
        };
    }, [db, isAuthReady]);

    const favoriteTechnicians = useMemo(() => {
        const favs = {};
        clients.forEach(client => {
            const clientAppointments = appointments.filter(appt => appt.clientName === client.name);
            if (clientAppointments.length === 0) {
                favs[client.id] = 'N/A';
                return;
            }
            const techCounts = clientAppointments.reduce((acc, appt) => {
                const tech = appt.technician;
                if (tech && tech !== 'Any') {
                    acc[tech] = (acc[tech] || 0) + 1;
                }
                return acc;
            }, {});
    
            const sortedTechs = Object.entries(techCounts).sort((a, b) => b[1] - a[1]);
            favs[client.id] = sortedTechs.length > 0 ? sortedTechs[0][0] : 'N/A';
        });
        return favs;
    }, [clients, appointments]);

    const handleExportClients = () => {
        if (typeof XLSX === 'undefined') {
            alert("Excel export library is not available.");
            return;
        }
        const dataToExport = clients.map(c => ({
            Name: c.name,
            Phone: c.phone,
            'Favorite Technician': favoriteTechnicians[c.id] || 'N/A'
        }));
        const ws = XLSX.utils.json_to_sheet(dataToExport);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, "Clients");
        XLSX.writeFile(wb, "Clients.xlsx");
    };

    const handleFileChange = (e) => {
        const file = e.target.files[0];
        const reader = new FileReader();
        reader.onload = async (evt) => {
            const bstr = evt.target.result;
            const wb = XLSX.read(bstr, {type:'binary'});
            const wsname = wb.SheetNames[0];
            const ws = wb.Sheets[wsname];
            const data = XLSX.utils.sheet_to_json(ws);
            
            const batch = writeBatch(db);
            data.forEach((row) => {
                const newClientRef = doc(collection(db, `artifacts/${getSafeAppId()}/public/data/clients`));
                batch.set(newClientRef, {
                    name: row.Name || '',
                    phone: row.Phone || '',
                    checkInTime: Timestamp.now(),
                    status: 'imported',
                    // Add other default fields as necessary
                });
            });
            await batch.commit();
            alert("Clients imported successfully!");
        };
        reader.readAsBinaryString(file);
    };

    return (
    <div className="p-6 bg-white rounded-lg shadow">
        <div className="flex justify-between items-center mb-4">
            <h2 className="text-xl font-semibold text-gray-700">All Clients (Check-In History)</h2>
            <div className="flex space-x-2">
                <input type="file" ref={fileInputRef} onChange={handleFileChange} className="hidden" accept=".xlsx, .xls" />
                <button onClick={() => fileInputRef.current.click()} className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 flex items-center">
                    <Icon path="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m.75 12l3 3m0 0l3-3m-3 3v-6m-1.5-9H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" className="w-5 h-5 mr-2" />
                    Import
                </button>
                <button onClick={handleExportClients} className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 flex items-center">
                    <Icon path="M9 8.25H7.5a2.25 2.25 0 00-2.25 2.25v9a2.25 2.25 0 002.25 2.25h9A2.25 2.25 0 0019.5 19.5v-9a2.25 2.25 0 00-2.25-2.25H15M9 12l3 3m0 0l3-3m-3 3V2.25" className="w-5 h-5 mr-2" />
                    Export
                </button>
            </div>
        </div>
        {isLoading ? <p>Loading...</p> : (<div className="overflow-x-auto"><table className="min-w-full bg-white"><thead className="bg-gray-50"><tr><th className="py-3 px-6 text-left text-xs font-medium text-gray-500 uppercase">Name</th><th className="py-3 px-6 text-left text-xs font-medium text-gray-500 uppercase">Phone</th><th className="py-3 px-6 text-left text-xs font-medium text-gray-500 uppercase">Favorite Technician</th></tr></thead><tbody className="divide-y divide-gray-200">{clients.map(client => (<tr key={client.id}><td className="py-4 px-6">{client.name}</td><td className="py-4 px-6">{client.phone}</td><td className="py-4 px-6">{favoriteTechnicians[client.id]}</td></tr>))}</tbody></table></div>)}
    </div>
    );
};
const ServiceManagement = ({ db, isAuthReady }) => {
    const [services, setServices] = useState([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [currentService, setCurrentService] = useState({ name: '', price: '', duration: '', category: '' });
    const [isEditing, setIsEditing] = useState(false);
    const [message, setMessage] = useState('');
    const categories = useMemo(() => [...new Set(services.map(s => s.category))], [services]);

    useEffect(() => {
        if (!isAuthReady) return;
        const unsubscribe = onSnapshot(collection(db, `artifacts/${getSafeAppId()}/public/data/services`), (snapshot) => {
            setServices(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
            setIsLoading(false);
        }, console.error);
        return () => unsubscribe();
    }, [db, isAuthReady]);

    const handleOpenModal = (service = null) => {
        setMessage('');
        setCurrentService(service ? { ...service } : { name: '', price: '', duration: '', category: '' });
        setIsEditing(!!service);
        setIsModalOpen(true);
    };

    const handleSaveService = async () => {
        if (!currentService.name || !currentService.price || !currentService.duration || !currentService.category) {
            setMessage("All fields are required.");
            return;
        }
        
        try {
            const dataToSave = { 
                name: currentService.name,
                price: Number(currentService.price),
                duration: Number(currentService.duration),
                category: currentService.category
            };
            if (isEditing) {
                const serviceDocRef = doc(db, `artifacts/${getSafeAppId()}/public/data/services`, currentService.id);
                await updateDoc(serviceDocRef, dataToSave);
                setMessage("Service updated successfully!");
            } else {
                const servicesCollection = collection(db, `artifacts/${getSafeAppId()}/public/data/services`);
                await addDoc(servicesCollection, dataToSave);
                setMessage("Service added successfully!");
            }
            setIsModalOpen(false);
        } catch (error) { 
            console.error("Error saving service:", error);
            setMessage(`Error: ${error.message}`);
            alert(`Failed to save service: ${error.message}`);
        }
    };

    const handleDeleteService = async (id) => {
        if (window.confirm("Are you sure you want to delete this service?")) {
            try {
                await deleteDoc(doc(db, `artifacts/${getSafeAppId()}/public/data/services`, id));
                setMessage("Service deleted successfully.");
            } catch (error) {
                console.error("Error deleting service:", error);
                setMessage(`Error: ${error.message}`);
                alert(`Failed to delete service: ${error.message}`);
            }
        }
    };
    return (<div><div className="flex justify-between items-center mb-4"><h2 className="text-xl font-semibold text-gray-700">Service Management</h2><button onClick={() => handleOpenModal()} className="px-4 py-2 bg-pink-500 text-white rounded-lg hover:bg-pink-600 flex items-center"><Icon path="M12 4.5v15m7.5-7.5h-15" className="w-5 h-5 mr-2" />Add Service</button></div>{message && <p className="my-2 text-center text-sm text-gray-600">{message}</p>}{isLoading ? <p>Loading...</p> : (<div className="overflow-x-auto"><table className="min-w-full bg-white"><thead className="bg-gray-50"><tr><th className="py-3 px-6 text-left text-xs font-medium text-gray-500 uppercase">Name</th><th className="py-3 px-6 text-left text-xs font-medium text-gray-500 uppercase">Category</th><th className="py-3 px-6 text-left text-xs font-medium text-gray-500 uppercase">Price ($)</th><th className="py-3 px-6 text-left text-xs font-medium text-gray-500 uppercase">Duration (min)</th><th className="py-3 px-6 text-right text-xs font-medium text-gray-500 uppercase">Actions</th></tr></thead><tbody className="divide-y divide-gray-200">{services.map(service => (<tr key={service.id}><td className="py-4 px-6">{service.name}</td><td className="py-4 px-6">{service.category}</td><td className="py-4 px-6">{service.price ? service.price.toFixed(2) : 'N/A'}</td><td className="py-4 px-6">{service.duration}</td><td className="py-4 px-6 text-right space-x-2"><button onClick={() => handleOpenModal(service)} className="text-indigo-600 hover:text-indigo-900"><Icon path="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931z" className="w-5 h-5" /></button><button onClick={() => handleDeleteService(service.id)} className="text-red-600 hover:text-red-900"><Icon path="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.134-2.09-2.134H8.09a2.09 2.09 0 00-2.09 2.134v.916m7.5 0a48.667 48.667 0 00-7.5 0" className="w-5 h-5" /></button></td></tr>))}</tbody></table></div>)}{isModalOpen && <ServiceModal service={currentService} setService={setCurrentService} onClose={() => setIsModalOpen(false)} onSave={handleSaveService} isEditing={isEditing} categories={categories} message={message} />}</div>);
};
const ServiceModal = ({ service, setService, onClose, onSave, isEditing, categories, message }) => (<div className="fixed inset-0 bg-black bg-opacity-50 z-50 overflow-y-auto p-4"><div className="bg-white p-6 rounded-lg shadow-xl w-full max-w-md mx-auto my-8"><h3 className="text-lg font-medium text-gray-900 mb-4">{isEditing ? 'Edit Service' : 'Add New Service'}</h3><div className="space-y-4"><input type="text" placeholder="Service Name" value={service.name} onChange={e => setService({...service, name: e.target.value})} className="w-full px-3 py-2 border border-gray-300 rounded-md" /><input type="text" list="category-suggestions" placeholder="Category" value={service.category} onChange={e => setService({...service, category: e.target.value})} className="w-full px-3 py-2 border border-gray-300 rounded-md" /><datalist id="category-suggestions">{categories.map(cat => <option key={cat} value={cat} />)}</datalist><input type="number" placeholder="Price" value={service.price} onChange={e => setService({...service, price: e.target.value})} className="w-full px-3 py-2 border border-gray-300 rounded-md" /><input type="number" placeholder="Duration (minutes)" value={service.duration} onChange={e => setService({...service, duration: e.target.value})} className="w-full px-3 py-2 border border-gray-300 rounded-md" /></div>{message && <p className="text-red-500 text-sm mt-2">{message}</p>}<div className="mt-6 flex justify-end space-x-3"><button onClick={onClose} className="w-auto px-4 py-2 bg-gray-200 text-gray-800 rounded-md hover:bg-gray-300">Cancel</button><button onClick={onSave} className="w-auto px-4 py-2 bg-pink-500 text-white rounded-md hover:bg-pink-600">{isEditing ? 'Update' : 'Save'}</button></div></div></div>);

const SalonEarningReportTab = ({ db, storage, isAuthReady, userRole }) => {
    const [reportSubTab, setReportSubTab] = useState('earnings');
    
    return (
        <div className="bg-white p-6 rounded-lg shadow-lg space-y-6">
            <h1 className="text-2xl font-bold text-gray-800">Salon Reports</h1>
            <div className="border-b">
                <nav className="-mb-px flex space-x-8" aria-label="Tabs">
                    <button onClick={() => setReportSubTab('earnings')} className={`whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm ${reportSubTab === 'earnings' ? 'border-pink-500 text-pink-600' : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'}`}>Earnings Report</button>
                    {userRole === 'admin' && (
                        <button onClick={() => setReportSubTab('expenses')} className={`whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm ${reportSubTab === 'expenses' ? 'border-pink-500 text-pink-600' : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'}`}>Monthly Expenses</button>
                    )}
                </nav>
            </div>
            
            {reportSubTab === 'earnings' && <EarningsSection db={db} isAuthReady={isAuthReady} />}
            {reportSubTab === 'expenses' && userRole === 'admin' && <SalonExpenses db={db} storage={storage} />}
        </div>
    );
};

const EarningsSection = ({ db, isAuthReady }) => {
    const [staff, setStaff] = useState([]);
    const [reports, setReports] = useState([]);
    const [isLoading, setIsLoading] = useState(true);
    const [formState, setFormState] = useState({ date: new Date().toISOString().slice(0, 10) });
    const [selectedMonth, setSelectedMonth] = useState(new Date().getMonth());
    const [editingReport, setEditingReport] = useState(null);
    const fileInputRef = useRef(null);

    const monthOptions = [
        "January", "February", "March", "April", "May", "June", 
        "July", "August", "September", "October", "November", "December", "This Year"
    ];

    useEffect(() => {
        if (!isAuthReady) return;

        const fetchStaff = async () => {
            setIsLoading(true);
            try {
                const usersQuery = query(collection(db, `users`), where("role", "!=", "admin"));
                const usersSnapshot = await getDocs(usersQuery);
                const staffData = usersSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
                setStaff(staffData);
                const initialFormState = { date: new Date().toISOString().slice(0, 10) };
                staffData.forEach(tech => {
                    initialFormState[tech.name] = '';
                });
                setFormState({
                    ...initialFormState,
                    sellGiftCard: '', returnGiftCard: '', check: '',
                    noOfCredit: '', totalCredit: '', venmo: '', square: ''
                });
            } catch (error) {
                console.error("Error fetching staff for reports:", error);
            } finally {
                setIsLoading(false);
            }
        };
        fetchStaff();
    }, [db, isAuthReady]);

    useEffect(() => {
        if (!isAuthReady || staff.length === 0) return;
        
        const year = new Date().getFullYear();
        let startOfPeriod, endOfPeriod;

        if(selectedMonth === 12) {
            startOfPeriod = new Date(year, 0, 1);
            endOfPeriod = new Date(year, 11, 31, 23, 59, 59, 999);
        } else {
            startOfPeriod = new Date(year, selectedMonth, 1);
            endOfPeriod = new Date(year, selectedMonth + 1, 0, 23, 59, 59, 999);
        }

        const q = query(collection(db, `artifacts/${getSafeAppId()}/public/data/salonEarnings`), where("date", ">=", Timestamp.fromDate(startOfPeriod)), where("date", "<=", Timestamp.fromDate(endOfPeriod)));
        
        const unsubscribe = onSnapshot(q, (snapshot) => {
            const fetchedReports = snapshot.docs.map(doc => ({id: doc.id, ...doc.data()}));
            setReports(fetchedReports);
        }, (error) => {
            console.error("Error fetching reports:", error);
        });

        return () => unsubscribe();

    }, [db, isAuthReady, selectedMonth, staff]);


    const handleInputChange = (e) => {
        const { name, value } = e.target;
        setFormState(prev => ({ ...prev, [name]: value }));
    };
    
    const handleUpdateReport = async (reportId, updatedData) => {
        const reportDocRef = doc(db, `artifacts/${getSafeAppId()}/public/data/salonEarnings`, reportId);
        await updateDoc(reportDocRef, updatedData);
        setEditingReport(null);
      };

    const handleAddEarning = async (e) => {
        e.preventDefault();
        const reportDate = new Date(formState.date);
        
        const technicianAmounts = staff.reduce((acc, tech) => {
            acc[tech.name] = Number(formState[tech.name]) || 0;
            return acc;
        }, {});

        const newReport = {
            date: Timestamp.fromDate(reportDate),
            technicianAmounts,
            sellGiftCard: Number(formState.sellGiftCard) || 0,
            returnGiftCard: Number(formState.returnGiftCard) || 0,
            check: Number(formState.check) || 0,
            noOfCredit: Number(formState.noOfCredit) || 0,
            totalCredit: Number(formState.totalCredit) || 0,
            venmo: Number(formState.venmo) || 0,
            square: Number(formState.square) || 0,
        };

        try {
            await addDoc(collection(db, `artifacts/${getSafeAppId()}/public/data/salonEarnings`), newReport);
            alert("Salon Earning Added!");
            const initialFormState = {};
            staff.forEach(tech => {
                initialFormState[tech.name] = '';
            });
            setFormState({
                ...initialFormState,
                date: new Date().toISOString().slice(0, 10),
                sellGiftCard: '', returnGiftCard: '', check: '',
                noOfCredit: '', totalCredit: '', venmo: '', square: ''
            });
        } catch (error) {
            console.error("Error adding salon earning:", error);
            alert("Failed to add earning report.");
        }
    };
    
    const handleExport = () => {
        if (typeof XLSX === 'undefined') {
            alert("Excel export library is not available.");
            return;
        }
        const wsData = [
            ["Date", ...staff.map(s => s.name), "Sell GC", "Return GC", "Check", "No. of Credit", "Total Credit", "Venmo", "Square", "Cash", "Total Earn"],
            ...reports.map(report => {
                const totalTechnicianEarn = Object.values(report.technicianAmounts).reduce((a, b) => a + b, 0);
                const totalEarn = (totalTechnicianEarn + (report.sellGiftCard || 0)) + ((report.noOfCredit || 0) * 2);
                const cash = totalEarn - ((report.totalCredit || 0) + (report.check || 0) + (report.returnGiftCard || 0) + (report.venmo || 0) + (report.square || 0));
                return [
                    report.date.toDate().toLocaleDateString(),
                    ...staff.map(tech => report.technicianAmounts[tech.name] || 0),
                    report.sellGiftCard || 0,
                    report.returnGiftCard || 0,
                    report.check || 0,
                    report.noOfCredit || 0,
                    report.totalCredit || 0,
                    report.venmo || 0,
                    report.square || 0,
                    cash,
                    totalEarn
                ];
            }),
            [], 
            ["Total:", ...staff.map(tech => totals[tech.name]), totals.sellGiftCard, totals.returnGiftCard, totals.check, totals.noOfCredit, totals.totalCredit, totals.venmo, totals.square, totals.cash, totals.totalEarn],
            ["Commission 70%:", ...staff.map(tech => totals[tech.name] * 0.7)],
            ["70% of Check:", ...staff.map(tech => (totals[tech.name] * 0.7) * 0.7)],
            ["30% of Cash:", ...staff.map(tech => (totals[tech.name] * 0.7) - ((totals[tech.name] * 0.7) * 0.7))],
        ];

        const ws = XLSX.utils.aoa_to_sheet(wsData);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, "Salon Earning Report");
        XLSX.writeFile(wb, "SalonEarningReport.xlsx");
    };

    const handlePrint = () => {
        window.print();
    };
    
    const handleDeleteReport = async (id) => {
        if(window.confirm("Are you sure you want to delete this report?")){
            await deleteDoc(doc(db, `artifacts/${getSafeAppId()}/public/data/salonEarnings`, id));
        }
    }

    const formatCurrency = (num) => `$${Number(num).toFixed(2)}`;
    const formatCount = (num) => Number(num).toFixed(0);

    const totals = useMemo(() => {
        const calculated = {
            sellGiftCard: 0, returnGiftCard: 0, check: 0,
            noOfCredit: 0, totalCredit: 0, venmo: 0, square: 0,
            cash: 0, totalEarn: 0
        };
        staff.forEach(tech => {
            calculated[tech.name] = 0;
        });

        reports.forEach(report => {
            const totalTechnicianEarn = Object.values(report.technicianAmounts).reduce((a, b) => a + b, 0);
            const totalEarn = (totalTechnicianEarn + (report.sellGiftCard || 0)) + ((report.noOfCredit || 0) * 2);
            const cash = totalEarn - ((report.totalCredit || 0) + (report.check || 0) + (report.returnGiftCard || 0) + (report.venmo || 0) + (report.square || 0));
            
            staff.forEach(tech => {
                calculated[tech.name] += report.technicianAmounts[tech.name] || 0;
            });
            calculated.sellGiftCard += report.sellGiftCard || 0;
            calculated.returnGiftCard += report.returnGiftCard || 0;
            calculated.check += report.check || 0;
            calculated.noOfCredit += report.noOfCredit || 0;
            calculated.totalCredit += report.totalCredit || 0;
            calculated.venmo += report.venmo || 0;
            calculated.square += report.square || 0;
            calculated.cash += cash;
            calculated.totalEarn += totalEarn;
        });
        return calculated;
    }, [reports, staff]);

    if (isLoading) {
        return <LoadingScreen text="Loading Report Data..." />;
    }

    return (
        <div className="space-y-6">
            <form onSubmit={handleAddEarning} className="space-y-6 print:hidden mt-4">
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-x-6 gap-y-4">
                    {staff.map(tech => (
                        <div key={tech.id}>
                            <label className="block text-sm font-medium text-gray-700">{tech.name}</label>
                            <input type="number" name={tech.name} placeholder="Amount" value={formState[tech.name] || ''} onChange={handleInputChange} className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm" />
                        </div>
                    ))}
                </div>
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-x-6 gap-y-4">
                     <div><label className="block text-sm font-medium text-gray-700">Sell Gift Card</label><input type="number" name="sellGiftCard" placeholder="Amount" value={formState.sellGiftCard} onChange={handleInputChange} className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm" /></div>
                     <div><label className="block text-sm font-medium text-gray-700">Return Gift Card</label><input type="number" name="returnGiftCard" placeholder="Amount" value={formState.returnGiftCard} onChange={handleInputChange} className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm" /></div>
                     <div><label className="block text-sm font-medium text-gray-700">Check</label><input type="number" name="check" placeholder="Amount" value={formState.check} onChange={handleInputChange} className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm" /></div>
                     <div><label className="block text-sm font-medium text-gray-700">No. of Credit</label><input type="number" name="noOfCredit" placeholder="Count" value={formState.noOfCredit} onChange={handleInputChange} className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm" /></div>
                     <div><label className="block text-sm font-medium text-gray-700">Total Credit</label><input type="number" name="totalCredit" placeholder="Amount" value={formState.totalCredit} onChange={handleInputChange} className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm" /></div>
                     <div><label className="block text-sm font-medium text-gray-700">Venmo</label><input type="number" name="venmo" placeholder="Amount" value={formState.venmo} onChange={handleInputChange} className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm" /></div>
                     <div><label className="block text-sm font-medium text-gray-700">Square</label><input type="number" name="square" placeholder="Amount" value={formState.square} onChange={handleInputChange} className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm" /></div>
                     <div><label className="block text-sm font-medium text-gray-700">Report Date</label><input type="date" name="date" value={formState.date} onChange={handleInputChange} className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm" /></div>
                </div>
                <div className="text-center pt-2">
                    <button type="submit" className="inline-flex justify-center py-3 px-8 border border-transparent shadow-sm text-base font-medium rounded-full text-white bg-pink-600 hover:bg-pink-700">
                        Add Salon Earning
                    </button>
                </div>
            </form>
            {editingReport && (
            <EarningReportEditModal
                report={editingReport}
                staff={staff}
                onClose={() => setEditingReport(null)}
                onSave={handleUpdateReport}
            />
            )}

            <div id="printable-area" className="border-t pt-6 mt-6">
                <div className="flex justify-end items-center gap-4 mb-4 print:hidden">
                    <button onClick={handleExport} className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700"><Icon path="M9 8.25H7.5a2.25 2.25 0 00-2.25 2.25v9a2.25 2.25 0 002.25 2.25h9A2.25 2.25 0 0019.5 19.5v-9a2.25 2.25 0 00-2.25-2.25H15M9 12l3 3m0 0l3-3m-3 3V2.25" className="w-5 h-5"/> Export</button>
                    <button onClick={handlePrint} className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"><Icon path="M6.72 13.829c-.24.03-.48.062-.72.096m.72-.096a42.415 42.415 0 0110.56 0m-10.56 0L6 3.129M6 20.871l4.5-13.5M11.25 3.129l4.5 13.5m0 0l4.5 4.5m-4.5-4.5l-4.5-4.5M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125V6.375c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v.001c0 .621.504 1.125 1.125 1.125z" className="w-5 h-5"/> Print</button>
                    <select value={selectedMonth} onChange={e => setSelectedMonth(Number(e.target.value))} className="px-4 py-2 border border-gray-300 rounded-md">
                        {monthOptions.map((month, index) => <option key={month} value={index}>{month}</option>)}
                    </select>
                </div>
                <div className="overflow-x-auto print:overflow-visible">
                    <table className="min-w-full divide-y divide-gray-200">
                        <thead className="bg-gray-50">
                            <tr>
                                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Date</th>
                                {staff.map(tech => <th key={tech.id} className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">{tech.name}</th>)}
                                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Sell GC</th>
                                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Return GC</th>
                                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Check</th>
                                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">No. of Credit</th>
                                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Total Credit</th>
                                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Venmo</th>
                                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Square</th>
                                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Cash</th>
                                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Total Earn</th>
                                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider print:hidden">Action</th>
                            </tr>
                        </thead>
                        <tbody className="bg-white divide-y divide-gray-200">
                            {reports.length === 0 ? (
                                <tr><td colSpan={staff.length + 12} className="text-center py-4">No salon earnings found for this date.</td></tr>
                            ) : (
                                reports.map(report => {
                                    const totalTechnicianEarn = Object.values(report.technicianAmounts).reduce((a, b) => a + b, 0);
                                    const totalEarn = (totalTechnicianEarn + (report.sellGiftCard || 0)) + ((report.noOfCredit || 0) * 2);
                                    const cash = totalEarn - ((report.totalCredit || 0) + (report.check || 0) + (report.returnGiftCard || 0) + (report.venmo || 0) + (report.square || 0));
                                    return (
                                        <tr key={report.id}>
                                            <td className="px-4 py-4 whitespace-nowrap">{report.date.toDate().toLocaleDateString()}</td>
                                            {staff.map(tech => <td key={tech.id} className="px-4 py-4 whitespace-nowrap">{formatCurrency(report.technicianAmounts[tech.name] || 0)}</td>)}
                                            <td className="px-4 py-4 whitespace-nowrap">{formatCurrency(report.sellGiftCard)}</td>
                                            <td className="px-4 py-4 whitespace-nowrap">{formatCurrency(report.returnGiftCard)}</td>
                                            <td className="px-4 py-4 whitespace-nowrap">{formatCurrency(report.check)}</td>
                                            <td className="px-4 py-4 whitespace-nowrap">{formatCount(report.noOfCredit)}</td>
                                            <td className="px-4 py-4 whitespace-nowrap">{formatCurrency(report.totalCredit)}</td>
                                            <td className="px-4 py-4 whitespace-nowrap">{formatCurrency(report.venmo)}</td>
                                            <td className="px-4 py-4 whitespace-nowrap">{formatCurrency(report.square)}</td>
                                            <td className="px-4 py-4 whitespace-nowrap">{formatCurrency(cash)}</td>
                                            <td className="px-4 py-4 whitespace-nowrap">{formatCurrency(totalEarn)}</td>
                                            <td className="px-4 py-4 whitespace-nowrap text-right text-sm font-medium space-x-2 print:hidden">
                                                <button onClick={() => setEditingReport(report)} className="text-indigo-600 hover:text-indigo-900"><Icon path="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931z" className="w-5 h-5" /></button>
                                                <button onClick={() => handleDeleteReport(report.id)} className="text-red-600 hover:text-red-900"><Icon path="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.134-2.09-2.134H8.09a2.09 2.09 0 00-2.09 2.134v.916m7.5 0a48.667 48.667 0 00-7.5 0" className="w-5 h-5" /></button>
                                            </td>
                                        </tr>
                                    );
                                })
                            )}
                        </tbody>
                        <tfoot className="bg-gray-50 font-bold">
                            <tr>
                                <td className="px-4 py-3 text-left">Total:</td>
                                {staff.map(tech => <td key={tech.id} className="px-4 py-3">{formatCurrency(totals[tech.name])}</td>)}
                                <td className="px-4 py-3">{formatCurrency(totals.sellGiftCard)}</td>
                                <td className="px-4 py-3">{formatCurrency(totals.returnGiftCard)}</td>
                                <td className="px-4 py-3">{formatCurrency(totals.check)}</td>
                                <td className="px-4 py-3">{formatCount(totals.noOfCredit)}</td>
                                <td className="px-4 py-3">{formatCurrency(totals.totalCredit)}</td>
                                <td className="px-4 py-3">{formatCurrency(totals.venmo)}</td>
                                <td className="px-4 py-3">{formatCurrency(totals.square)}</td>
                                <td className="px-4 py-3">{formatCurrency(totals.cash)}</td>
                                <td className="px-4 py-3">{formatCurrency(totals.totalEarn)}</td>
                                <td className="print:hidden"></td>
                            </tr>
                             <tr>
                                <td className="px-4 py-3 text-left">Commission 70%:</td>
                                {staff.map(tech => <td key={tech.id} className="px-4 py-3">{formatCurrency(totals[tech.name] * 0.7)}</td>)}
                                <td colSpan="11"></td>
                            </tr>
                             <tr>
                                <td className="px-4 py-3 text-left">70% of Check:</td>
                                {staff.map(tech => <td key={tech.id} className="px-4 py-3">{formatCurrency((totals[tech.name] * 0.7) * 0.7)}</td>)}
                                <td colSpan="11"></td>
                            </tr>
                             <tr>
                                <td className="px-4 py-3 text-left">30% of Cash:</td>
                                {staff.map(tech => <td key={tech.id} className="px-4 py-3">{formatCurrency((totals[tech.name] * 0.7) - ((totals[tech.name] * 0.7) * 0.7))}</td>)}
                                <td colSpan="11"></td>
                            </tr>
                        </tfoot>
                    </table>
                </div>
            </div>
        </div>
    );
};

const EarningReportEditModal = ({ report, staff, onClose, onSave }) => {
    const [formState, setFormState] = useState({});
  
    useEffect(() => {
      const initialState = { ...report.technicianAmounts };
      initialState.sellGiftCard = report.sellGiftCard || '';
      initialState.returnGiftCard = report.returnGiftCard || '';
      initialState.check = report.check || '';
      initialState.noOfCredit = report.noOfCredit || '';
      initialState.totalCredit = report.totalCredit || '';
      initialState.venmo = report.venmo || '';
      initialState.square = report.square || '';
      initialState.date = report.date.toDate().toISOString().slice(0, 10);
      setFormState(initialState);
    }, [report]);
  
    const handleInputChange = (e) => {
      const { name, value } = e.target;
      setFormState(prev => ({ ...prev, [name]: value }));
    };
  
    const handleSaveChanges = () => {
        const technicianAmounts = staff.reduce((acc, tech) => {
            acc[tech.name] = Number(formState[tech.name]) || 0;
            return acc;
        }, {});

        const updatedReportData = {
            technicianAmounts,
            sellGiftCard: Number(formState.sellGiftCard) || 0,
            returnGiftCard: Number(formState.returnGiftCard) || 0,
            check: Number(formState.check) || 0,
            noOfCredit: Number(formState.noOfCredit) || 0,
            totalCredit: Number(formState.totalCredit) || 0,
            venmo: Number(formState.venmo) || 0,
            square: Number(formState.square) || 0,
            date: Timestamp.fromDate(new Date(formState.date))
        };
      onSave(report.id, updatedReportData);
    };
  
    return (
      <div className="fixed inset-0 bg-black bg-opacity-50 z-50 overflow-y-auto p-4">
        <div className="bg-white p-6 rounded-lg shadow-xl w-full max-w-3xl mx-auto my-8">
          <h3 className="text-2xl font-bold text-gray-800 mb-6">Edit Earning Report for {report.date.toDate().toLocaleDateString()}</h3>
          <div className="space-y-4 max-h-96 overflow-y-auto">
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                {staff.map(tech => (
                    <div key={tech.id}>
                        <label className="block text-sm font-medium text-gray-700">{tech.name}</label>
                        <input type="number" name={tech.name} value={formState[tech.name] || ''} onChange={handleInputChange} className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm" />
                    </div>
                ))}
                <div><label className="block text-sm font-medium text-gray-700">Sell Gift Card</label><input type="number" name="sellGiftCard" value={formState.sellGiftCard} onChange={handleInputChange} className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm" /></div>
                <div><label className="block text-sm font-medium text-gray-700">Return Gift Card</label><input type="number" name="returnGiftCard" value={formState.returnGiftCard} onChange={handleInputChange} className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm" /></div>
                <div><label className="block text-sm font-medium text-gray-700">Check</label><input type="number" name="check" value={formState.check} onChange={handleInputChange} className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm" /></div>
                <div><label className="block text-sm font-medium text-gray-700">No. of Credit</label><input type="number" name="noOfCredit" value={formState.noOfCredit} onChange={handleInputChange} className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm" /></div>
                <div><label className="block text-sm font-medium text-gray-700">Total Credit</label><input type="number" name="totalCredit" value={formState.totalCredit} onChange={handleInputChange} className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm" /></div>
                <div><label className="block text-sm font-medium text-gray-700">Venmo</label><input type="number" name="venmo" value={formState.venmo} onChange={handleInputChange} className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm" /></div>
                <div><label className="block text-sm font-medium text-gray-700">Square</label><input type="number" name="square" value={formState.square} onChange={handleInputChange} className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm" /></div>
                <div><label className="block text-sm font-medium text-gray-700">Report Date</label><input type="date" name="date" value={formState.date || ''} onChange={handleInputChange} className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm" /></div>
            </div>
          </div>
          <div className="mt-6 flex justify-end space-x-3">
            <button onClick={onClose} className="w-auto px-6 py-2 bg-gray-200 text-gray-800 rounded-md hover:bg-gray-300">Cancel</button>
            <button onClick={handleSaveChanges} className="w-auto px-6 py-2 bg-pink-600 text-white rounded-md hover:bg-pink-700">Save Changes</button>
          </div>
        </div>
      </div>
    );
  };

const BookingSettings = ({ db }) => {
    const [leadTime, setLeadTime] = useState(0);
    const [message, setMessage] = useState('');

    const settingsDocRef = doc(db, `artifacts/${getSafeAppId()}/public/data/settings`, 'booking');

    useEffect(() => {
        const unsub = onSnapshot(settingsDocRef, (doc) => {
            if (doc.exists()) {
                setLeadTime(doc.data().leadTime || 0);
            }
        });
        return () => unsub();
    }, [db]);

    const handleSave = async () => {
        try {
            await setDoc(settingsDocRef, { leadTime: Number(leadTime) });
            setMessage('Settings saved successfully!');
            setTimeout(() => setMessage(''), 3000);
        } catch (error) {
            console.error("Error saving settings:", error);
            setMessage('Failed to save settings.');
            alert(`Failed to save settings: ${error.message}`);
        }
    };

    return (
        <div>
            <h2 className="text-xl font-semibold text-gray-700 mb-4">Booking Settings</h2>
            <div className="flex items-center space-x-4">
                <label htmlFor="leadTime" className="text-sm font-medium text-gray-700">Minimum Booking Lead Time (hours):</label>
                <input 
                    type="number" 
                    id="leadTime"
                    value={leadTime}
                    onChange={(e) => setLeadTime(e.target.value)}
                    className="w-24 px-3 py-2 border border-gray-300 rounded-md"
                />
                <button onClick={handleSave} className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600">Save</button>
            </div>
            {message && <p className="mt-4 text-sm text-green-600">{message}</p>}
        </div>
    );
};

const TechnicianTaskManager = ({ db }) => {
    const [tasks, setTasks] = useState([]);
    const [newTask, setNewTask] = useState({ 
        note: 'SNS', 
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }), 
        technician: '' 
    });
    const [technicians, setTechnicians] = useState([]);
    const tasksCollectionRef = collection(db, `artifacts/${getSafeAppId()}/public/data/technicianTasks`);

    const taskNotesOptions = ["SNS", "acrylic full set", "acrylic fill in", "design"];

    useEffect(() => {
        const usersQuery = query(collection(db, 'users'), where("role", "==", "technician"));
        const unsubUsers = onSnapshot(usersQuery, (snapshot) => {
            const techData = snapshot.docs.map(doc => doc.data().name || doc.data().email);
            setTechnicians(techData);
            if (techData.length > 0 && !newTask.technician) {
                setNewTask(prev => ({ ...prev, technician: techData[0] }));
            }
        });

        const unsubscribe = onSnapshot(tasksCollectionRef, (snapshot) => {
            setTasks(snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id })));
        });

        return () => {
            unsubUsers();
            unsubscribe();
        };
    }, [db]);

    const handleAddTask = async () => {
        if (newTask.note.trim() === '' || !newTask.technician || newTask.time.trim() === '') {
            alert("Please fill all fields for the task.");
            return;
        }
        try {
            await addDoc(tasksCollectionRef, { ...newTask, status: 'To Do', createdAt: Timestamp.now() });
            setNewTask({ 
                note: 'SNS', 
                time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }), 
                technician: technicians[0] || '' 
            });
        } catch(error) {
            console.error("Error adding task:", error);
            alert(`Failed to add task: ${error.message}`);
        }
    };

    const handleDragStart = (e, taskId) => {
        e.dataTransfer.setData("taskId", taskId);
    };

    const handleDrop = async (e, status) => {
        const taskId = e.dataTransfer.getData("taskId");
        const taskDocRef = doc(db, `artifacts/${getSafeAppId()}/public/data/technicianTasks`, taskId);
        try {
            await updateDoc(taskDocRef, { status });
        } catch (error) {
            console.error("Error updating task status:", error);
            alert(`Failed to update task: ${error.message}`);
        }
    };

    const handleDragOver = (e) => {
        e.preventDefault();
    };
    
    const handleDeleteTask = async (taskId) => {
        if (window.confirm("Are you sure you want to delete this task?")) {
            const taskDocRef = doc(db, `artifacts/${getSafeAppId()}/public/data/technicianTasks`, taskId);
            try {
                await deleteDoc(taskDocRef);
            } catch (error) {
                console.error("Error deleting task:", error);
                alert(`Failed to delete task: ${error.message}`);
            }
        }
    };

    const columns = ['To Do', 'In Progress', 'Done'];

    return (
        <div>
            <h2 className="text-xl font-semibold text-gray-700 mb-4">Task Manager</h2>
            <div className="flex flex-wrap items-end gap-2 mb-4">
                <div className="flex-grow" style={{flexBasis: '24%'}}>
                    <label className="block text-sm font-medium text-gray-700">Camera (Technician)</label>
                    <select value={newTask.technician} onChange={e => setNewTask({...newTask, technician: e.target.value})} className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md">
                        {technicians.map(t => <option key={t} value={t}>{t}</option>)}
                    </select>
                </div>
                <div className="flex-grow" style={{flexBasis: '24%'}}>
                    <label className="block text-sm font-medium text-gray-700">Record Time</label>
                    <input type="text" placeholder="e.g., 09:00 AM" value={newTask.time} onChange={e => setNewTask({...newTask, time: e.target.value})} className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md" />
                </div>
                <div className="flex-grow" style={{flexBasis: '24%'}}>
                    <label className="block text-sm font-medium text-gray-700">Record Note</label>
                    <select value={newTask.note} onChange={e => setNewTask({...newTask, note: e.target.value})} className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md">
                        {taskNotesOptions.map(opt => <option key={opt} value={opt}>{opt}</option>)}
                    </select>
                </div>
                <button onClick={handleAddTask} className="px-4 py-2 bg-pink-500 text-white rounded-lg hover:bg-pink-600">Add Task</button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-8">
                {columns.map(status => (
                    <div 
                        key={status}
                        className="bg-gray-100 p-4 rounded-lg"
                        onDragOver={handleDragOver}
                        onDrop={(e) => handleDrop(e, status)}
                    >
                        <h3 className="font-bold mb-2 text-center">{status}</h3>
                        <div className="space-y-2">
                            {tasks.filter(task => task.status === status).map(task => (
                                <div 
                                    key={task.id}
                                    draggable
                                    onDragStart={(e) => handleDragStart(e, task.id)}
                                    className="bg-white p-3 rounded shadow cursor-grab"
                                >
                                    <p className="font-semibold">{task.note}</p>
                                    <p className="text-sm text-gray-600">{task.technician} - {task.time}</p>
                                    <button onClick={() => handleDeleteTask(task.id)} className="text-red-400 hover:text-red-600 float-right -mt-5">
                                        <Icon path="M6 18L18 6M6 6l12 12" className="w-4 h-4" />
                                    </button>
                                </div>
                            ))}
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
};

const SalonExpenses = ({ db, storage }) => {
    const [expenses, setExpenses] = useState([]);
    const [newExpense, setNewExpense] = useState({ name: '', amount: '', date: new Date().toISOString().slice(0,10), supplier: '', paymentAccount: '' });
    const [invoiceFile, setInvoiceFile] = useState(null);
    const [uploadProgress, setUploadProgress] = useState(0);
    const [isUploading, setIsUploading] = useState(false);
    const [suppliers, setSuppliers] = useState([]);
    const [paymentAccounts, setPaymentAccounts] = useState([]);
    const expensesCollectionRef = collection(db, `artifacts/${getSafeAppId()}/public/data/salonExpenses`);

    useEffect(() => {
        const unsubscribe = onSnapshot(expensesCollectionRef, (snapshot) => {
            setExpenses(snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id })));
        });
        const unsubSuppliers = onSnapshot(doc(db, `artifacts/${getSafeAppId()}/public/data/settings`, 'suppliers'), (doc) => {
            if (doc.exists()) setSuppliers(doc.data().list || []);
        });
        const unsubAccounts = onSnapshot(doc(db, `artifacts/${getSafeAppId()}/public/data/settings`, 'paymentAccounts'), (doc) => {
            if (doc.exists()) setPaymentAccounts(doc.data().list || []);
        });
        return () => {
            unsubscribe();
            unsubSuppliers();
            unsubAccounts();
        };
    }, [db]);

    const handleAddExpense = async () => {
        if (!newExpense.name || !newExpense.amount || !newExpense.date) {
            alert("Please fill out all expense fields.");
            return;
        }

        let invoiceURL = '';
        let invoicePath = '';
        if (invoiceFile) {
            setIsUploading(true);
            invoicePath = `invoices/${getSafeAppId()}/${Date.now()}_${invoiceFile.name}`;
            const storageRef = ref(storage, invoicePath);
            const uploadTask = uploadBytesResumable(storageRef, invoiceFile);

            uploadTask.on('state_changed', 
                (snapshot) => {
                    const progress = (snapshot.bytesTransferred / snapshot.totalBytes) * 100;
                    setUploadProgress(progress);
                }, 
                (error) => {
                    console.error("Upload failed:", error);
                    setIsUploading(false);
                }, 
                async () => {
                    invoiceURL = await getDownloadURL(uploadTask.snapshot.ref);
                    await addDoc(expensesCollectionRef, { 
                        ...newExpense, 
                        amount: Number(newExpense.amount),
                        date: Timestamp.fromDate(new Date(newExpense.date)),
                        invoiceURL,
                        invoicePath
                    });
                    resetForm();
                }
            );
        } else {
            await addDoc(expensesCollectionRef, { 
                ...newExpense, 
                amount: Number(newExpense.amount),
                date: Timestamp.fromDate(new Date(newExpense.date)),
            });
            resetForm();
        }
    };

    const resetForm = () => {
        setNewExpense({ name: '', amount: '', date: new Date().toISOString().slice(0,10), supplier: '', paymentAccount: '' });
        setInvoiceFile(null);
        setIsUploading(false);
        setUploadProgress(0);
    };

    const handleDeleteExpense = async (expense) => {
        if (window.confirm("Are you sure you want to delete this expense?")) {
            const expenseDocRef = doc(db, `artifacts/${getSafeAppId()}/public/data/salonExpenses`, expense.id);
            await deleteDoc(expenseDocRef);

            if (expense.invoicePath) {
                const invoiceRef = ref(storage, expense.invoicePath);
                await deleteObject(invoiceRef).catch(err => console.error("Error deleting invoice file:", err));
            }
        }
    };

    return (
        <div className="mt-6">
            <h2 className="text-xl font-semibold text-gray-700 mb-4">Monthly Salon Expenses</h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
                <input type="text" placeholder="Expense Name" value={newExpense.name} onChange={e => setNewExpense({...newExpense, name: e.target.value})} className="w-full px-3 py-2 border border-gray-300 rounded-md" />
                <input type="number" placeholder="Amount" value={newExpense.amount} onChange={e => setNewExpense({...newExpense, amount: e.target.value})} className="w-full px-3 py-2 border border-gray-300 rounded-md" />
                <input type="date" value={newExpense.date} onChange={e => setNewExpense({...newExpense, date: e.target.value})} className="w-full px-3 py-2 border border-gray-300 rounded-md" />
                <select value={newExpense.supplier} onChange={e => setNewExpense({...newExpense, supplier: e.target.value})} className="w-full px-3 py-2 border border-gray-300 rounded-md bg-white">
                    <option value="">Select Supplier</option>
                    {suppliers.map(s => <option key={s.id} value={s.name}>{s.name}</option>)}
                </select>
                <select value={newExpense.paymentAccount} onChange={e => setNewExpense({...newExpense, paymentAccount: e.target.value})} className="w-full px-3 py-2 border border-gray-300 rounded-md bg-white">
                    <option value="">Select Payment Account</option>
                    {paymentAccounts.map(a => <option key={a} value={a}>{a}</option>)}
                </select>
                <input type="file" onChange={e => setInvoiceFile(e.target.files[0])} accept="image/*,application/pdf" className="w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-pink-50 file:text-pink-700 hover:file:bg-pink-100"/>
            </div>
            {isUploading && <div className="w-full bg-gray-200 rounded-full h-2.5 mb-4"><div className="bg-pink-600 h-2.5 rounded-full" style={{width: `${uploadProgress}%`}}></div></div>}
            <button onClick={handleAddExpense} disabled={isUploading} className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:bg-gray-400">
                {isUploading ? 'Uploading...' : 'Add Expense'}
            </button>

            <div className="overflow-x-auto mt-6">
                <table className="min-w-full bg-white">
                    <thead className="bg-gray-50">
                        <tr>
                            <th className="py-3 px-6 text-left text-xs font-medium text-gray-500 uppercase">Date</th>
                            <th className="py-3 px-6 text-left text-xs font-medium text-gray-500 uppercase">Expense</th>
                            <th className="py-3 px-6 text-left text-xs font-medium text-gray-500 uppercase">Amount</th>
                            <th className="py-3 px-6 text-left text-xs font-medium text-gray-500 uppercase">Supplier</th>
                            <th className="py-3 px-6 text-left text-xs font-medium text-gray-500 uppercase">Payment Account</th>
                            <th className="py-3 px-6 text-center text-xs font-medium text-gray-500 uppercase">Invoice</th>
                            <th className="py-3 px-6 text-right text-xs font-medium text-gray-500 uppercase">Actions</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200">
                        {expenses.map(exp => (
                            <tr key={exp.id}>
                                <td className="py-4 px-6">{exp.date.toDate().toLocaleDateString()}</td>
                                <td className="py-4 px-6">{exp.name}</td>
                                <td className="py-4 px-6">${Number(exp.amount).toFixed(2)}</td>
                                <td className="py-4 px-6">{exp.supplier}</td>
                                <td className="py-4 px-6">{exp.paymentAccount}</td>
                                <td className="py-4 px-6 text-center">
                                    {exp.invoiceURL ? <a href={exp.invoiceURL} target="_blank" rel="noopener noreferrer" className="text-blue-500 hover:underline">View</a> : 'N/A'}
                                </td>
                                <td className="py-4 px-6 text-right">
                                    <button onClick={() => handleDeleteExpense(exp)} className="text-red-500 hover:text-red-700">
                                        <Icon path="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.134-2.09-2.134H8.09a2.09 2.09 0 00-2.09 2.134v.916m7.5 0a48.667 48.667 0 00-7.5 0" className="w-5 h-5" />
                                    </button>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
};

const Settings = ({ db }) => {
    const [suppliers, setSuppliers] = useState([]);
    const [paymentAccounts, setPaymentAccounts] = useState([]);
    const [newSupplier, setNewSupplier] = useState({ name: '', phone: '', email: '', website: '', address: '' });
    const [newAccount, setNewAccount] = useState('');
    const [editingSupplier, setEditingSupplier] = useState(null);

    const suppliersDocRef = doc(db, `artifacts/${getSafeAppId()}/public/data/settings`, 'suppliers');
    const accountsDocRef = doc(db, `artifacts/${getSafeAppId()}/public/data/settings`, 'paymentAccounts');

    useEffect(() => {
        const unsubSuppliers = onSnapshot(suppliersDocRef, (doc) => {
            if (doc.exists()) setSuppliers(doc.data().list || []);
        });
        const unsubAccounts = onSnapshot(accountsDocRef, (doc) => {
            if (doc.exists()) setPaymentAccounts(doc.data().list || []);
        });
        return () => {
            unsubSuppliers();
            unsubAccounts();
        };
    }, [db]);

    const handleAddItem = async (type) => {
        const value = type === 'supplier' ? { ...newSupplier, id: doc(collection(db, '_')).id } : newAccount;
        if ((type === 'supplier' && newSupplier.name.trim() === '') || (type === 'account' && newAccount.trim() === '')) return;

        const docRef = type === 'supplier' ? suppliersDocRef : accountsDocRef;
        try {
            await updateDoc(docRef, { list: arrayUnion(value) });
        } catch (e) {
            if (e.code === 'not-found') {
                await setDoc(docRef, { list: [value] });
            } else {
                console.error("Error adding item:", e);
                alert(`Failed to add item: ${e.message}`);
            }
        } finally {
            if (type === 'supplier') setNewSupplier({ name: '', phone: '', email: '', website: '', address: '' });
            else setNewAccount('');
        }
    };

    const handleUpdateSupplier = async (updatedSupplier) => {
        const newSuppliersList = suppliers.map(s => s.id === updatedSupplier.id ? updatedSupplier : s);
        try {
            await setDoc(suppliersDocRef, { list: newSuppliersList });
            setEditingSupplier(null);
        } catch (error) {
            console.error("Error updating supplier:", error);
            alert(`Failed to update supplier: ${error.message}`);
        }
    };

    const handleDeleteItem = async (type, value) => {
        const docRef = type === 'supplier' ? suppliersDocRef : accountsDocRef;
        await updateDoc(docRef, { list: arrayRemove(value) });
    };

    return (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            <div>
                <h3 className="text-lg font-semibold text-gray-700 mb-4">Manage Suppliers</h3>
                <div className="space-y-2 mb-4">
                    <input type="text" value={newSupplier.name} onChange={e => setNewSupplier({...newSupplier, name: e.target.value})} placeholder="Supplier Name" className="w-full px-3 py-2 border border-gray-300 rounded-md" />
                    <input type="text" value={newSupplier.phone} onChange={e => setNewSupplier({...newSupplier, phone: e.target.value})} placeholder="Contact Phone" className="w-full px-3 py-2 border border-gray-300 rounded-md" />
                    <input type="email" value={newSupplier.email} onChange={e => setNewSupplier({...newSupplier, email: e.target.value})} placeholder="Email" className="w-full px-3 py-2 border border-gray-300 rounded-md" />
                    <input type="text" value={newSupplier.website} onChange={e => setNewSupplier({...newSupplier, website: e.target.value})} placeholder="Website" className="w-full px-3 py-2 border border-gray-300 rounded-md" />
                    <input type="text" value={newSupplier.address} onChange={e => setNewSupplier({...newSupplier, address: e.target.value})} placeholder="Address" className="w-full px-3 py-2 border border-gray-300 rounded-md" />
                </div>
                <button onClick={() => handleAddItem('supplier')} className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 w-full">Add Supplier</button>
                <ul className="space-y-2 mt-4">
                    {suppliers.map((s, i) => <li key={s.id || i} className="flex justify-between items-start bg-gray-50 p-2 rounded-md">
                        <div>
                            <p className="font-semibold">{s.name}</p>
                            <p className="text-sm text-gray-600">{s.phone}</p>
                            <p className="text-sm text-gray-600">{s.email}</p>
                            <p className="text-sm text-gray-600">{s.website}</p>
                            <p className="text-sm text-gray-600">{s.address}</p>
                        </div>
                        <div className="flex space-x-2">
                            <button onClick={() => setEditingSupplier(s)} className="text-indigo-500"><Icon path="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931z" className="w-4 h-4"/></button>
                            <button onClick={() => handleDeleteItem('supplier', s)} className="text-red-500"><Icon path="M6 18L18 6M6 6l12 12" className="w-4 h-4"/></button>
                        </div>
                    </li>)}
                </ul>
            </div>
            <div>
                <h3 className="text-lg font-semibold text-gray-700 mb-4">Manage Payment Accounts</h3>
                <div className="flex mb-4">
                    <input type="text" value={newAccount} onChange={e => setNewAccount(e.target.value)} placeholder="New account" className="flex-grow px-3 py-2 border border-gray-300 rounded-l-md" />
                    <button onClick={() => handleAddItem('account')} className="px-4 py-2 bg-blue-500 text-white rounded-r-lg hover:bg-blue-600">Add</button>
                </div>
                <ul className="space-y-2">
                    {paymentAccounts.map(a => <li key={a} className="flex justify-between items-center bg-gray-50 p-2 rounded-md"><span>{a}</span><button onClick={() => handleDeleteItem('account', a)} className="text-red-500"><Icon path="M6 18L18 6M6 6l12 12" className="w-4 h-4"/></button></li>)}
                </ul>
            </div>
            {editingSupplier && <SupplierEditModal supplier={editingSupplier} onSave={handleUpdateSupplier} onClose={() => setEditingSupplier(null)} />}
        </div>
    );
};

const SupplierEditModal = ({ supplier, onSave, onClose }) => {
    const [editedSupplier, setEditedSupplier] = useState(supplier);

    return (
        <div className="fixed inset-0 bg-black bg-opacity-50 z-50 overflow-y-auto p-4">
            <div className="bg-white p-6 rounded-lg shadow-xl w-full max-w-md mx-auto my-8">
                <h3 className="text-lg font-medium text-gray-900 mb-4">Edit Supplier</h3>
                <div className="space-y-4">
                    <input type="text" value={editedSupplier.name} onChange={e => setEditedSupplier({...editedSupplier, name: e.target.value})} placeholder="Supplier Name" className="w-full px-3 py-2 border border-gray-300 rounded-md" />
                    <input type="text" value={editedSupplier.phone} onChange={e => setEditedSupplier({...editedSupplier, phone: e.target.value})} placeholder="Contact Phone" className="w-full px-3 py-2 border border-gray-300 rounded-md" />
                    <input type="email" value={editedSupplier.email} onChange={e => setEditedSupplier({...editedSupplier, email: e.target.value})} placeholder="Email" className="w-full px-3 py-2 border border-gray-300 rounded-md" />
                    <input type="text" value={editedSupplier.website} onChange={e => setEditedSupplier({...editedSupplier, website: e.target.value})} placeholder="Website" className="w-full px-3 py-2 border border-gray-300 rounded-md" />
                    <input type="text" value={editedSupplier.address} onChange={e => setEditedSupplier({...editedSupplier, address: e.target.value})} placeholder="Address" className="w-full px-3 py-2 border border-gray-300 rounded-md" />
                </div>
                <div className="mt-6 flex justify-end space-x-3">
                    <button onClick={onClose} className="w-auto px-4 py-2 bg-gray-200 text-gray-800 rounded-md hover:bg-gray-300">Cancel</button>
                    <button onClick={() => onSave(editedSupplier)} className="w-auto px-4 py-2 bg-blue-500 text-white rounded-md hover:bg-blue-600">Save Changes</button>
                </div>
            </div>
        </div>
    );
};



