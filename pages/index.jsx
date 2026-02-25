import dynamic from "next/dynamic";
import Head from "next/head";

// Dynamic import with ssr:false — required for PWA (uses window, navigator, localStorage)
const App = dynamic(() => import("../components/App"), { ssr: false });

export default function Home() {
  return (
    <>
      <Head>
        <title>Street Hunt</title>
        <meta name="description" content="Find stickers hidden around the city. Photograph them. Earn points. Own the map."/>
        <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no"/>
        <meta name="theme-color" content="#0A0A0A"/>
        <meta name="mobile-web-app-capable" content="yes"/>
        <meta name="apple-mobile-web-app-capable" content="yes"/>
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent"/>
        <meta name="apple-mobile-web-app-title" content="Street Hunt"/>
        <link rel="manifest" href="/manifest.json"/>
        <link rel="apple-touch-icon" href="/icons/icon-192.png"/>
      </Head>
      <App />
    </>
  );
}

