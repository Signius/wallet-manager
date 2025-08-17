import styles from "../styles/Home.module.css";

export default function Home() {
    return (
        <div className={styles.page}>
            <main className={styles.main}>
                <h1 className={styles.title}>Welcome to Wallet Manager</h1>
                <p className={styles.description}>
                    A simple and secure way to manage your digital wallets
                </p>

                <div className={styles.features}>
                    <div className={styles.feature}>
                        <h3>Secure</h3>
                        <p>Your wallet data is encrypted and stored locally</p>
                    </div>
                    <div className={styles.feature}>
                        <h3>Simple</h3>
                        <p>Easy-to-use interface for managing multiple wallets</p>
                    </div>
                    <div className={styles.feature}>
                        <h3>Fast</h3>
                        <p>Quick access to your wallet information</p>
                    </div>
                </div>

                <div className={styles.ctas}>
                    <button className={styles.primary}>
                        Get Started
                    </button>
                    <button className={styles.secondary}>
                        Learn More
                    </button>
                </div>
            </main>

            <footer className={styles.footer}>
                <p>2025 Wallet Manager</p>
            </footer>
        </div>
    );
}
