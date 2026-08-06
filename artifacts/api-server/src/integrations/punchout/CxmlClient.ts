import type {
  PunchoutInitRequest,
  PunchoutInitResponse,
  PunchoutCartReturn,
  VendorCredentials,
} from '../types';
import { XMLParser } from 'fast-xml-parser';
import crypto from 'crypto';

/**
 * cXML PunchOut Client
 * 
 * Implements cXML protocol for PunchOut catalog integration.
 * Used primarily by US Foods for interactive shopping cart sessions.
 */

export interface CxmlConfig {
  punchoutUrl: string;
  sharedSecret: string;
  buyerDomain: string;
  buyerIdentity: string;
}

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
});

/**
 * cXML PunchOut Client
 */
export class CxmlClient {
  constructor(
    private vendorName: string,
    private config: CxmlConfig
  ) {}

  /**
   * Initialize PunchOut session
   * Sends cXML SetupRequest and returns redirect URL
   */
  async initSession(req: PunchoutInitRequest): Promise<PunchoutInitResponse> {
    console.log(`[cXML] Initializing PunchOut session with ${this.vendorName}`);

    const setupRequest = this.buildSetupRequest(req);
    
    try {
      const response = await fetch(this.config.punchoutUrl, {
        method: 'POST',
        headers: { 
          'Content-Type': 'text/xml',
          'Accept': 'text/xml',
        },
        body: setupRequest,
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const responseXml = await response.text();
      const parsed = xmlParser.parse(responseXml);

      // Extract redirect URL from cXML response
      const cxml = parsed.cXML;
      const setupResponse = cxml?.Response?.PunchOutSetupResponse;
      
      if (!setupResponse) {
        throw new Error('Invalid cXML response: missing PunchOutSetupResponse');
      }

      const redirectUrl = setupResponse.StartPage?.URL;
      if (!redirectUrl) {
        throw new Error('Invalid cXML response: missing redirect URL');
      }

      const sessionId = `${this.vendorName.toUpperCase()}-${Date.now()}`;

      return {
        sessionId,
        redirectUrl,
      };
    } catch (error) {
      console.error('[cXML] Setup request failed:', error);
      throw new Error(`Failed to initialize PunchOut session: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Process cart return from vendor
   * Parses cXML OrderRequest and extracts line items
   */
  async processCartReturn(cxmlPayload: string): Promise<PunchoutCartReturn> {
    console.log(`[cXML] Processing cart return from ${this.vendorName}`);

    try {
      const parsed = xmlParser.parse(cxmlPayload);
      const cxml = parsed.cXML;
      
      if (!cxml?.Message?.PunchOutOrderMessage) {
        throw new Error('Invalid cXML: missing PunchOutOrderMessage');
      }

      const orderMessage = cxml.Message.PunchOutOrderMessage;
      const buyerCookie = orderMessage.BuyerCookie || `${this.vendorName}-SESSION`;
      
      // Extract line items from ItemIn elements
      const itemsData = orderMessage.ItemIn;
      const items = [];
      
      if (itemsData) {
        const itemsArray = Array.isArray(itemsData) ? itemsData : [itemsData];
        
        for (const item of itemsArray) {
          const money = item.ItemDetail?.UnitPrice?.Money;
          const unitPrice = parseFloat(
            typeof money === 'object' ? (money['#text'] || money) : money || '0'
          );
          
          items.push({
            vendorSku: item.ItemID?.SupplierPartID || '',
            quantity: parseFloat(item['@_quantity'] || '0'),
            unitPrice,
            description: item.ItemDetail?.Description?.['#text'] || item.ItemDetail?.Description || '',
          });
        }
      }

      // Calculate total
      const totalAmount = items.reduce((sum, item) => sum + (item.quantity * item.unitPrice), 0);

      return {
        sessionId: buyerCookie,
        items,
        totalAmount,
      };
    } catch (error) {
      console.error('[cXML] Cart parsing failed:', error);
      throw new Error(`Failed to parse PunchOut cart return: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Build cXML SetupRequest XML
   */
  private buildSetupRequest(req: PunchoutInitRequest): string {
    const timestamp = new Date().toISOString();
    const payloadId = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE cXML SYSTEM "http://xml.cxml.org/schemas/cXML/1.2.014/cXML.dtd">
<cXML version="1.2.014" xml:lang="en-US" payloadID="${payloadId}" timestamp="${timestamp}">
  <Header>
    <From>
      <Credential domain="${this.config.buyerDomain}">
        <Identity>${this.config.buyerIdentity}</Identity>
      </Credential>
    </From>
    <To>
      <Credential domain="NetworkId">
        <Identity>${this.vendorName}</Identity>
      </Credential>
    </To>
    <Sender>
      <Credential domain="${this.config.buyerDomain}">
        <Identity>${this.config.buyerIdentity}</Identity>
        <SharedSecret>${this.config.sharedSecret}</SharedSecret>
      </Credential>
      <UserAgent>Restaurant Inventory System 1.0</UserAgent>
    </Sender>
  </Header>
  <Request>
    <PunchOutSetupRequest operation="create">
      <BuyerCookie>${req.buyerCookie}</BuyerCookie>
      <Extrinsic name="UserEmail">${req.buyerEmail || ''}</Extrinsic>
      <Extrinsic name="UserId">${req.buyerUserId}</Extrinsic>
      <BrowserFormPost>
        <URL>${req.returnUrl}</URL>
      </BrowserFormPost>
      <Contact role="buyer">
        <Email>${req.buyerEmail || ''}</Email>
      </Contact>
    </PunchOutSetupRequest>
  </Request>
</cXML>`;
  }

  /**
   * Validate cXML signature using HMAC-SHA256
   */
  validateSignature(cxmlPayload: string, signature: string): boolean {
    try {
      const hmac = crypto.createHmac('sha256', this.config.sharedSecret);
      hmac.update(cxmlPayload);
      const expectedSignature = hmac.digest('hex');
      
      // Ensure both signatures are the same length before comparison
      if (signature.length !== expectedSignature.length) {
        return false;
      }
      
      // Constant-time comparison to prevent timing attacks
      return crypto.timingSafeEqual(
        Buffer.from(signature, 'hex'),
        Buffer.from(expectedSignature, 'hex')
      );
    } catch (error) {
      console.error('[cXML] Signature validation failed:', error);
      return false;
    }
  }
}

/**
 * Factory function to create cXML client from vendor credentials
 */
export function createCxmlClient(
  vendorName: string,
  credentials: VendorCredentials
): CxmlClient {
  const config: CxmlConfig = {
    punchoutUrl: credentials.punchoutUrl || '',
    sharedSecret: credentials.sharedSecret || '',
    buyerDomain: 'RestaurantInventory',
    buyerIdentity: credentials.accountNumber || 'BUYER001',
  };

  return new CxmlClient(vendorName, config);
}
