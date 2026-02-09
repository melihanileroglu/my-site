// firebase.js (DÜZENLENMİŞ TAM HALİ) - Firestore kaldırıldı, sadece Auth
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";

const firebaseConfig = {
  apiKey: "AIzaSyCYNxoSyqNEB_iXGXA6Xs7pNJttNwzUg6Y",
  authDomain: "cbs-web-map.firebaseapp.com",
  projectId: "cbs-web-map",
  storageBucket: "cbs-web-map.firebasestorage.app",
  messagingSenderId: "424412076633",
  appId: "1:424412076633:web:b990aa00a511d47d32ef48"
};

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
