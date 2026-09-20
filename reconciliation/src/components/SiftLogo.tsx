import Image from "next/image";
import styles from "./sift-logo.module.css";

export function SiftLogo() {
  return (
    <span className={styles.logo}>
      <Image src="/sift-logo.png" alt="Sift" width={1774} height={887} sizes="216px" className={styles.image} />
    </span>
  );
}
