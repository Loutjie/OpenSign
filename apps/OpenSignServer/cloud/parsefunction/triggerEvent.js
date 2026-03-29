import axios from 'axios';
import { cloudServerUrl, serverAppId } from '../../Utils.js';

export default async function triggerEvent(request) {
  const event = request.params.event;
  const body = request.params.body;
  const docId = body.objectId;
  const contactId = request.params.contactId;
  const serverUrl = cloudServerUrl; //process.env.SERVER_URL;
  const appId = serverAppId;
  const sessiontoken = request.headers?.sessiontoken;

  try {
    const docQuery = new Parse.Query('contracts_Document');
    docQuery.select(['Name', 'IsEnableOTP', 'SignedUrl', 'AuditTrail', 'WebhookUrl', 'Signers']);
    const docRes = await docQuery.get(docId, { useMasterKey: true });
    const _docRes = docRes && docRes?.toJSON();
    const isEnableOTP = docRes?.get('IsEnableOTP') || false;
    const ipAddress = request.headers['x-real-ip'] || '';

    if (isEnableOTP) {
      let userId;
      if (sessiontoken) {
        const userRes = await axios.get(serverUrl + '/users/me', {
          headers: {
            'X-Parse-Application-Id': appId,
            'X-Parse-Session-Token': sessiontoken,
          },
        });
        userId = userRes.data && userRes.data.objectId;
      }
      if (!userId) {
        return { message: 'User not found!' };
      }
    }

    if (event === 'viewed' && contactId) {
      const auditTrail = Array.isArray(_docRes.AuditTrail) ? _docRes.AuditTrail : [];
      const contactPtr = {
        __type: 'Pointer',
        className: 'contracts_Contactbook',
        objectId: contactId,
      };
      const date = new Date().toISOString();
      const newEntry = {
        UserPtr: contactPtr,
        SignedUrl: _docRes?.SignedUrl || '',
        Activity: 'Viewed',
        ipAddress,
        ViewedOn: date,
      };

      const existingIndex = auditTrail.findIndex(x => x?.UserPtr?.objectId === contactId);

      let updatedAuditTrail;

      if (existingIndex !== -1) {
        // update existing entry
        updatedAuditTrail = [...auditTrail];
        updatedAuditTrail[existingIndex] = {
          ...updatedAuditTrail[existingIndex],
          SignedUrl: _docRes?.SignedUrl || updatedAuditTrail[existingIndex]?.SignedUrl || '',
          Activity: 'Viewed',
          ipAddress,
          ViewedOn: date,
        };
      } else {
        // add new entry
        updatedAuditTrail = [...auditTrail, newEntry];
      }

      // save only once
      const updateDoc = new Parse.Object('contracts_Document');
      updateDoc.id = docRes.id;
      updateDoc.set('AuditTrail', updatedAuditTrail);
      await updateDoc.save(null, { useMasterKey: true });

      // Call external webhook if configured (LeaseLynx integration)
      const webhookUrl = docRes.get('WebhookUrl');
      if (webhookUrl) {
        try {
          // Fetch contact details for the viewer
          const contactQuery = new Parse.Query('contracts_Contactbook');
          const contact = await contactQuery.get(contactId, { useMasterKey: true });
          const contactData = contact?.toJSON();
          await axios.post(webhookUrl, {
            event: 'document_viewed',
            document_id: docId,
            signer: { name: contactData?.Name || '', email: contactData?.Email || '', role: contactData?.Role || '' },
            is_completed: false,
            total_signers: _docRes.Signers?.length || 0,
          });
          console.log(`Webhook sent: document_viewed → ${webhookUrl}`);
        } catch (whErr) {
          console.log(`Webhook failed: ${whErr.message}`);
        }
      }
    }

    return { message: 'event called!' };
  } catch (err) {
    console.log(
      `triggerEvent error: `,
      err?.response?.data?.error || err?.message || 'Something went wrong!'
    );
    return { message: 'Something went wrong!' };
  }
}
