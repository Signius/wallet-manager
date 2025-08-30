import type { AppProps } from "next/app";
import { Geist, Geist_Mono } from "next/font/google";
import { MeshProvider } from "@meshsdk/react";
import Navbar from "../components/Navbar";
import "../styles/globals.css";

const geistSans = Geist({
    variable: "--font-geist-sans",
    subsets: ["latin"],
});

const geistMono = Geist_Mono({
    variable: "--font-geist-mono",
    subsets: ["latin"],
});

export default function App({ Component, pageProps }: AppProps) {
    return (
        <MeshProvider>
            <div className={`${geistSans.variable} ${geistMono.variable}`}>
                <Navbar />
                <Component {...pageProps} />
            </div>
        </MeshProvider>
    );
}
