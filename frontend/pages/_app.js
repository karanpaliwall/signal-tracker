import { useState, useEffect, createContext, useContext } from 'react'
import { Inter } from 'next/font/google'
import Layout from '../components/Layout'
import '../styles/tokens.css'
import '../styles/reference.css'
import '../styles/custom.css'
import Head from 'next/head'

const inter = Inter({ subsets: ['latin'], weight: ['400', '500', '600', '700'] })

// Pipeline status context — shared across Layout and Dashboard to avoid duplicate polling.
export const StatusContext = createContext({ live_running: false, intelligence_running: false })

export function useStatus() {
  return useContext(StatusContext)
}

export default function App({ Component, pageProps }) {
  const [status, setStatus] = useState({ live_running: false, intelligence_running: false })

  useEffect(() => {
    const check = () => {
      fetch('/api/scrape/status').then(r => r.json()).then(setStatus).catch(() => {})
    }
    check()
    const iv = setInterval(check, 5000)
    return () => clearInterval(iv)
  }, [])

  return (
    <StatusContext.Provider value={status}>
      <style jsx global>{`
        html { font-family: ${inter.style.fontFamily}, sans-serif; }
      `}</style>
      <Head>
        <title>Signal Tracker</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link rel="icon" href="/favicon.png" />
      </Head>
      <Layout>
        <Component {...pageProps} />
      </Layout>
    </StatusContext.Provider>
  )
}
