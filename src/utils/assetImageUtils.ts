// Utility function to convert IPFS URLs to HTTP URLs
export const convertIpfsUrl = (url: string | null | undefined): string | null => {
    if (!url || typeof url !== 'string') return null;

    // Handle IPFS URLs
    if (url.startsWith('ipfs://')) {
        const hash = url.replace('ipfs://', '');
        // Use a public IPFS gateway (ipfs.io is generally reliable)
        return `https://ipfs.io/ipfs/${hash}`;
    }

    // Handle IPFS hash-only URLs (without ipfs:// prefix)
    if (url.startsWith('Qm') || url.startsWith('bafy') || url.startsWith('bafkrei') || url.startsWith('bafkreig')) {
        return `https://ipfs.io/ipfs/${url}`;
    }

    return url;
};

// Interface for asset metadata
export interface AssetMetadata {
    assetInfo?: {
        token_registry_metadata?: {
            logo?: string;
        };
        cip68_metadata?: {
            image?: string;
        };
        minting_tx_metadata?: {
            '721'?: Record<string, Record<string, { image?: string;[key: string]: unknown }>>;
            files?: Array<{ src: string }>;
            image?: string;
        };
        asset_name_ascii?: string;
    };
    assetName?: string;
    policyId?: string;
}

/**
 * Find the best available image for an asset from various metadata sources
 * Priority order:
 * 1. Token registry metadata logo
 * 2. CIP68 metadata image
 * 3. 721 metadata (NFT standard) - exact match by asset name
 * 4. 721 metadata - fuzzy match by asset name
 * 5. Files metadata
 * 6. Direct image metadata
 */
export const findAssetImage = (asset: AssetMetadata, debug: boolean = false): string | null => {
    if (debug) {
        console.log(`🔍 Looking for image for asset: ${asset.assetInfo?.asset_name_ascii || asset.assetName}`);
        console.log(`📋 Policy ID: ${asset.policyId}`);
    }

    // 1. Try to get image from token registry metadata
    if (asset.assetInfo?.token_registry_metadata?.logo) {
        const logo = asset.assetInfo.token_registry_metadata.logo;
        if (debug) console.log(`🏷️ Found token registry logo: ${logo}`);
        // Check if it's a base64 encoded image or a URL
        if (logo.startsWith('data:image/') || logo.startsWith('http')) {
            const convertedUrl = convertIpfsUrl(logo);
            if (debug) console.log(`✅ Using token registry logo: ${convertedUrl}`);
            return convertedUrl;
        }
        // If it's just base64 data without data URL prefix, add it
        if (logo.length > 100 && !logo.includes('://')) {
            if (debug) console.log(`✅ Using base64 logo data`);
            return `data:image/png;base64,${logo}`;
        }
    }

    // 2. Try to get image from CIP68 metadata
    if (asset.assetInfo?.cip68_metadata?.image) {
        if (debug) console.log(`📸 Found CIP68 image: ${asset.assetInfo.cip68_metadata.image}`);
        const convertedUrl = convertIpfsUrl(asset.assetInfo.cip68_metadata.image);
        if (debug) console.log(`✅ Using CIP68 image: ${convertedUrl}`);
        return convertedUrl;
    }

    // 3. Try to get image from minting tx metadata (721 standard)
    if (asset.assetInfo?.minting_tx_metadata?.['721']) {
        const metadata721 = asset.assetInfo.minting_tx_metadata['721'];
        if (debug) console.log(`🎨 Found 721 metadata for policy: ${asset.policyId}`);

        // Look for the specific asset in the 721 metadata
        if (asset.policyId && asset.assetInfo?.asset_name_ascii &&
            metadata721[asset.policyId] &&
            metadata721[asset.policyId][asset.assetInfo.asset_name_ascii]) {
            const assetMetadata = metadata721[asset.policyId][asset.assetInfo.asset_name_ascii];
            if (debug) console.log(`🎯 Found exact match for asset: ${asset.assetInfo.asset_name_ascii}`);
            if (assetMetadata && typeof assetMetadata === 'object' && 'image' in assetMetadata && assetMetadata.image) {
                if (debug) console.log(`✅ Found image in exact match: ${assetMetadata.image}`);
                const convertedUrl = convertIpfsUrl(assetMetadata.image as string);
                if (debug) console.log(`🔄 Converted to: ${convertedUrl}`);
                return convertedUrl;
            }
        }

        // If we didn't find it by exact match, try to find it by the asset name in the policy
        if (asset.policyId && metadata721[asset.policyId]) {
            const policyMetadata = metadata721[asset.policyId];
            if (debug) console.log(`🔍 Looking for fuzzy matches in policy ${asset.policyId}`);
            // Look for an asset with a name that matches or contains our asset name
            for (const assetName in policyMetadata) {
                const assetMetadata = policyMetadata[assetName];
                if (debug) console.log(`🔍 Checking asset name: "${assetName}" vs our asset: "${asset.assetInfo?.asset_name_ascii}"`);
                if (assetMetadata && typeof assetMetadata === 'object' && 'image' in assetMetadata && assetMetadata.image) {
                    // Check if this asset name matches our asset (case-insensitive)
                    const ourAssetName = asset.assetInfo?.asset_name_ascii || asset.assetName || '';
                    if (assetName.toLowerCase() === ourAssetName.toLowerCase() ||
                        assetName.toLowerCase().includes(ourAssetName.toLowerCase()) ||
                        ourAssetName.toLowerCase().includes(assetName.toLowerCase())) {
                        if (debug) console.log(`✅ Found fuzzy match: ${assetName} with image: ${assetMetadata.image}`);
                        const convertedUrl = convertIpfsUrl(assetMetadata.image as string);
                        if (debug) console.log(`🔄 Converted to: ${convertedUrl}`);
                        return convertedUrl;
                    }
                }
            }
        }

        // Fallback: check any asset in the policy for an image
        for (const policyId in metadata721) {
            const policyMetadata = metadata721[policyId];
            if (policyMetadata && typeof policyMetadata === 'object') {
                for (const assetName in policyMetadata) {
                    const assetMetadata = policyMetadata[assetName];
                    if (assetMetadata && typeof assetMetadata === 'object' && assetMetadata.image) {
                        return convertIpfsUrl(assetMetadata.image);
                    }
                }
            }
        }
    }

    // 4. Try to get image from other common metadata fields
    if (asset.assetInfo?.minting_tx_metadata?.files?.[0]?.src) {
        if (debug) console.log(`📁 Found file metadata: ${asset.assetInfo.minting_tx_metadata.files[0].src}`);
        const convertedUrl = convertIpfsUrl(asset.assetInfo.minting_tx_metadata.files[0].src);
        if (debug) console.log(`✅ Using file metadata: ${convertedUrl}`);
        return convertedUrl;
    }

    // 5. Check for image in minting_tx_metadata directly (non-721)
    if (asset.assetInfo?.minting_tx_metadata?.image) {
        if (debug) console.log(`🖼️ Found direct image metadata: ${asset.assetInfo.minting_tx_metadata.image}`);
        const convertedUrl = convertIpfsUrl(asset.assetInfo.minting_tx_metadata.image);
        if (debug) console.log(`✅ Using direct image metadata: ${convertedUrl}`);
        return convertedUrl;
    }

    if (debug) console.log(`❌ No image found for asset: ${asset.assetInfo?.asset_name_ascii || asset.assetName}`);
    return null;
};

/**
 * Get all available image URLs for an asset (useful for debugging or fallback scenarios)
 */
export const getAllAssetImages = (asset: AssetMetadata): string[] => {
    const images: string[] = [];

    // Token registry logo
    if (asset.assetInfo?.token_registry_metadata?.logo) {
        const converted = convertIpfsUrl(asset.assetInfo.token_registry_metadata.logo);
        if (converted) images.push(converted);
    }

    // CIP68 image
    if (asset.assetInfo?.cip68_metadata?.image) {
        const converted = convertIpfsUrl(asset.assetInfo.cip68_metadata.image);
        if (converted) images.push(converted);
    }

    // 721 metadata images
    if (asset.assetInfo?.minting_tx_metadata?.['721']) {
        const metadata721 = asset.assetInfo.minting_tx_metadata['721'];
        for (const policyId in metadata721) {
            const policyMetadata = metadata721[policyId];
            if (policyMetadata && typeof policyMetadata === 'object') {
                for (const assetName in policyMetadata) {
                    const assetMetadata = policyMetadata[assetName];
                    if (assetMetadata && typeof assetMetadata === 'object' && assetMetadata.image) {
                        const converted = convertIpfsUrl(assetMetadata.image);
                        if (converted) images.push(converted);
                    }
                }
            }
        }
    }

    // Files metadata
    if (asset.assetInfo?.minting_tx_metadata?.files) {
        asset.assetInfo.minting_tx_metadata.files.forEach(file => {
            if (file.src) {
                const converted = convertIpfsUrl(file.src);
                if (converted) images.push(converted);
            }
        });
    }

    // Direct image metadata
    if (asset.assetInfo?.minting_tx_metadata?.image) {
        const converted = convertIpfsUrl(asset.assetInfo.minting_tx_metadata.image);
        if (converted) images.push(converted);
    }

    return images;
};
