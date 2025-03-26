import {OAuthRegisteredClientsStore} from '@modelcontextprotocol/sdk/server/auth/clients.js';
import {AuthorizationParams, OAuthServerProvider} from '@modelcontextprotocol/sdk/server/auth/provider.js';
import {AuthInfo} from '@modelcontextprotocol/sdk/server/auth/types.js';
import {
    OAuthClientInformationFull,
    OAuthTokenRevocationRequest,
    OAuthTokens
} from '@modelcontextprotocol/sdk/shared/auth.js';
import {Response, Request} from 'express';
import {Installation, InstallProvider} from '@slack/oauth';
import fs from 'fs/promises';
import {v4 as uuidv4} from 'uuid';
import crypto from 'crypto';
import {SessionData} from './SessionData.js';
import path from 'path';

export class SlackAuthProvider implements OAuthServerProvider {
    private _installer: InstallProvider;
    private _clientsFilePath: string;
    private _clientsStoreImpl: OAuthRegisteredClientsStore;
    private _clientsMap: Map<string, OAuthClientInformationFull> = new Map();
    private _sessionStore: Map<string, SessionData> = new Map();


    constructor() {
        this._installer = new InstallProvider({
            clientId: process.env.SLACK_CLIENT_ID!,
            clientSecret: process.env.SLACK_CLIENT_SECRET!,
            stateSecret: process.env.SLACK_STATE_SECRET,
        });

        this._clientsFilePath = path.resolve(process.cwd(), 'registered_clients.json');

        this._clientsStoreImpl = {
            getClient: (clientId: string) => {
                console.log('Getting client ', clientId);
                return this._clientsMap.get(clientId);
            },

            registerClient: (client: OAuthClientInformationFull) => {
                this._clientsMap.set(client.client_id, client);
                console.log('Registered client ', client.client_id);

                this._saveClientsToFile().catch(err => {
                    console.error('Failed to save client registration:', err);
                });
                return client;
            }
        };
    }

    private generatePkce(): { verifier: string, challenge: string } {
        // Generate a random code verifier (43-128 chars)
        const verifier = uuidv4() + uuidv4() + uuidv4();

        // Create code challenge by hashing verifier with SHA256 and base64url encoding
        const challenge = crypto.createHash('sha256')
            .update(verifier)
            .digest('base64')
            .replace(/\+/g, '-')
            .replace(/\//g, '_')
            .replace(/=/g, '');

        return {verifier, challenge};
    }

    /**
     * Stores session data in memory using the state parameter as key
     * @param state - The state parameter used as the lookup key
     * @param data - The session data to store
     */
    private async _storeSessionData(state: string, data: SessionData): Promise<void> {
        if (!state) {
            throw new Error('Cannot store session data: state parameter is missing');
        }

        this._sessionStore.set(state, data);
        console.log(`Session data stored for state: ${state}`);
    }

    /**
     * Retrieves session data for a given state
     * @param state - The state parameter used as the lookup key
     * @returns The session data or undefined if not found
     */
    private _getSessionData(state: string): SessionData | undefined {
        return this._sessionStore.get(state);
    }

    /**
     * Removes session data after it's been used
     * @param state - The state parameter used as the lookup key
     */
    private _clearSessionData(state: string): void {
        this._sessionStore.delete(state);
        console.log(`Session data cleared for state: ${state}`);
    }

    /**
     * Load registered clients from file
     */
    private async _loadClientsFromFile(): Promise<void> {
        try {
            await fs.access(this._clientsFilePath)
                .catch(() => {
                    console.log('No saved clients file found. Starting with empty clients list.');
                    return Promise.reject(new Error('File not found'));
                });

            const fileContent = await fs.readFile(this._clientsFilePath, {encoding: 'utf8'});
            const clientsData = JSON.parse(fileContent);

            this._clientsMap.clear();
            for (const [clientId, clientData] of Object.entries(clientsData)) {
                this._clientsMap.set(clientId, clientData as OAuthClientInformationFull);
            }

            console.log(`Loaded ${this._clientsMap.size} registered clients from file.`);
        } catch (err) {
            if ((err as Error).message !== 'File not found') {
                console.error('Error loading clients from file:', err);
            }
        }
    }

    /**
     * Save registered clients to file
     */
    private async _saveClientsToFile(): Promise<void> {
        try {
            const clientsObject: Record<string, OAuthClientInformationFull> = {};
            for (const [clientId, clientData] of this._clientsMap.entries()) {
                clientsObject[clientId] = clientData;
            }

            await fs.writeFile(
                this._clientsFilePath,
                JSON.stringify(clientsObject, null, 2),
                {encoding: 'utf8'}
            );

            console.log(`Saved ${this._clientsMap.size} registered clients to file.`);
        } catch (err) {
            console.error('Error saving clients to file:', err);
            throw err;
        }
    }

    /**
     * Gets the clients store implementation
     */
    get clientsStore(): OAuthRegisteredClientsStore {
        return this._clientsStoreImpl;
    }


    async authorize(client: OAuthClientInformationFull, params: AuthorizationParams, res: Response): Promise<void> {

        try {
            const redirectUri = client.redirect_uris[0] as string;

            // Generate our own PKCE values instead of using client's
            const pkce = this.generatePkce();
            const codeChallengeMethod = 'S256';

            // Generate a secure random state parameter
            const state = crypto.randomBytes(32).toString('hex');

            // Store both the client's original state and our generated state
            const sessionData: SessionData = {
                clientId: client.client_id,
                state: state,
                codeVerifier: pkce.verifier,  // Store our verifier for later
                redirectUri: redirectUri,
                originalState: params.state as string,  // Store client's original state
                clientCodeChallenge: params.codeChallenge as string,
                clientCodeChallengeMethod: 'S256'
            };

            await this._storeSessionData(state, sessionData);

            const authUrl = await this._installer.generateInstallUrl({
                scopes: ['chat:write'],
                redirectUri
            })

            res.redirect(authUrl);

        } catch (error) {
            console.error('Authorization setup error:', error);
            res.status(500).send('Failed to initialize authentication: ' + error);
        }

    }

    challengeForAuthorizationCode(client: OAuthClientInformationFull, authorizationCode: string): Promise<string> {
        throw new Error('Method not implemented.');
    }

    exchangeAuthorizationCode(client: OAuthClientInformationFull, authorizationCode: string): Promise<OAuthTokens> {
        throw new Error('Method not implemented.');
    }

    exchangeRefreshToken(client: OAuthClientInformationFull, refreshToken: string, scopes?: string[]): Promise<OAuthTokens> {
        throw new Error('Method not implemented.');
    }

    verifyAccessToken(token: string): Promise<AuthInfo> {
        throw new Error('Method not implemented.');
    }

    revokeToken?(client: OAuthClientInformationFull, request: OAuthTokenRevocationRequest): Promise<void> {
        throw new Error('Method not implemented.');
    }

    public async handleCallback(req: Request, res: Response): Promise<{
        redirectUrl: string;
        success: boolean;
        error?: string;
    }> {
        try {
            const {state} = req.query;
            const sessionData = this._getSessionData(state as string);
            if (!sessionData) {
                return {redirectUrl: '', success: false, error: 'Invalid state parameter'};
            }

            await this._installer.handleCallback(req, res, {
                success(installation: Installation) {

                }
            });
        } catch (error) {
            console.error('Error handling callback:', error);
            return {redirectUrl: '', success: false, error: 'Failed to handle callback'};
        }
    }

}