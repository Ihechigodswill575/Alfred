// ============================================================
// Nexora — Firebase configuration
// Replace the values below with your actual Firebase project
// credentials from the Firebase Console → Project settings.
// ============================================================

const firebaseConfig = {
  apiKey: "AIzaSyBzUELxbbaL6Wb_M1uNhjwlZHVTorN9XJs",
  authDomain: "my-whatsapp-2c1af.firebaseapp.com",
  databaseURL: "https://my-whatsapp-2c1af-default-rtdb.firebaseio.com",
  projectId: "my-whatsapp-2c1af",
  storageBucket: "my-whatsapp-2c1af.firebasestorage.app",
  messagingSenderId: "1089455460888",
  appId: "1:1089455460888:web:15bd0820546c813febe96d"
};

firebase.initializeApp(firebaseConfig);

const db = firebase.firestore();
const auth = firebase.auth();

// The one email treated as the site administrator.
// Signing in with this email unlocks the /admin dashboard.
const ADMIN_EMAIL = 'ihechigodswill575@gmail.com';
