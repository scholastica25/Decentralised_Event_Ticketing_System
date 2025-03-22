import { Clarinet, Tx, Chain, Account, types } from 'https://deno.land/x/clarinet@v0.14.0/index.ts';
import { assertEquals } from 'https://deno.land/std@0.90.0/testing/asserts.ts';

// Constants for testing
const CONTRACT_NAME = 'decentralized-event-ticketing';

// Helper function to create an event
function createEventTx(sender: string, futureBlocks: number = 1000)
{
    return Tx.contractCall(
        CONTRACT_NAME,
        'create-event',
        [
            types.utf8('Concert XYZ'),
            types.utf8('A great musical experience'),
            types.utf8('Main Street Arena'),
            types.uint(futureBlocks), // Event date (current block height + future blocks)
            types.uint(100), // Total tickets
            types.uint(1500000), // Ticket price (1.5 STX)
            types.uint(144), // Refund window (1 day in blocks)
            types.utf8('Music')
        ],
        sender
    );
}

Clarinet.test({
    name: "Ensure that event creation works correctly",
    async fn(chain: Chain, accounts: Map<string, Account>)
    {
        const deployer = accounts.get('deployer')!;
        const organizer = accounts.get('wallet_1')!;
        const futureDate = chain.blockHeight + 1000;

        let block = chain.mineBlock([
            Tx.contractCall(
                CONTRACT_NAME,
                'create-event',
                [
                    types.utf8('Concert XYZ'),
                    types.utf8('A great musical experience'),
                    types.utf8('Main Street Arena'),
                    types.uint(futureDate),
                    types.uint(100), // Total tickets
                    types.uint(1500000), // Ticket price (1.5 STX)
                    types.uint(144), // Refund window (1 day in blocks)
                    types.utf8('Music')
                ],
                organizer.address
            )
        ]);

        assertEquals(block.receipts.length, 1);
        assertEquals(block.receipts[0].result, '(ok true)');

        // Verify the event was created with correct data
        const eventId = 1; // First event should have ID 1
        const eventData = chain.callReadOnlyFn(
            CONTRACT_NAME,
            'get-event',
            [types.uint(eventId)],
            deployer.address
        );

        const event = eventData.result.expectSome().expectTuple();
        assertEquals(event['name'], types.utf8('Concert XYZ'));
        assertEquals(event['organizer'], organizer.address);
        assertEquals(event['venue'], types.utf8('Main Street Arena'));
        assertEquals(event['total-tickets'], types.uint(100));
        assertEquals(event['tickets-sold'], types.uint(0));
        assertEquals(event['ticket-price'], types.uint(1500000));
        assertEquals(event['is-active'], types.bool(true));
        assertEquals(event['revenue'], types.uint(0));

        // Check organizer data was updated
        const organizerData = chain.callReadOnlyFn(
            CONTRACT_NAME,
            'get-organizer-revenue',
            [types.principal(organizer.address)],
            deployer.address
        );

        const organizerInfo = organizerData.result.expectSome().expectTuple();
        assertEquals(organizerInfo['events-organized'], types.uint(1));
    },
});

Clarinet.test({
    name: "Ensure that event creation fails with invalid parameters",
    async fn(chain: Chain, accounts: Map<string, Account>)
    {
        const organizer = accounts.get('wallet_1')!;
        const pastDate = chain.blockHeight - 100; // Date in the past

        // Test with price below minimum
        let block = chain.mineBlock([
            Tx.contractCall(
                CONTRACT_NAME,
                'create-event',
                [
                    types.utf8('Low Price Event'),
                    types.utf8('Testing'),
                    types.utf8('Venue'),
                    types.uint(chain.blockHeight + 1000),
                    types.uint(100),
                    types.uint(500000), // Price below minimum (assuming min is 1000000)
                    types.uint(144),
                    types.utf8('Test')
                ],
                organizer.address
            )
        ]);

        assertEquals(block.receipts.length, 1);
        assertEquals(block.receipts[0].result, '(err u5)'); // ERR-INVALID-PRICE

        // Test with past date
        block = chain.mineBlock([
            Tx.contractCall(
                CONTRACT_NAME,
                'create-event',
                [
                    types.utf8('Past Event'),
                    types.utf8('Testing'),
                    types.utf8('Venue'),
                    types.uint(pastDate),
                    types.uint(100),
                    types.uint(1500000),
                    types.uint(144),
                    types.utf8('Test')
                ],
                organizer.address
            )
        ]);

        assertEquals(block.receipts.length, 1);
        assertEquals(block.receipts[0].result, '(err u6)'); // ERR-EVENT-EXPIRED

        // Test with refund window too large
        block = chain.mineBlock([
            Tx.contractCall(
                CONTRACT_NAME,
                'create-event',
                [
                    types.utf8('Large Refund Window'),
                    types.utf8('Testing'),
                    types.utf8('Venue'),
                    types.uint(chain.blockHeight + 1000),
                    types.uint(100),
                    types.uint(1500000),
                    types.uint(2000000), // Very large refund window
                    types.utf8('Test')
                ],
                organizer.address
            )
        ]);

        assertEquals(block.receipts.length, 1);
        assertEquals(block.receipts[0].result, '(err u5)'); // ERR-INVALID-PRICE
    },
});

Clarinet.test({
    name: "Ensure that ticket purchase works correctly",
    async fn(chain: Chain, accounts: Map<string, Account>)
    {
        const organizer = accounts.get('wallet_1')!;
        const buyer = accounts.get('wallet_2')!;

        // First create an event
        let block = chain.mineBlock([
            createEventTx(organizer.address)
        ]);

        const eventId = 1; // First event ID
        const initialOrganizerBalance = organizer.balance;
        const initialBuyerBalance = buyer.balance;

        // Purchase a ticket
        block = chain.mineBlock([
            Tx.contractCall(
                CONTRACT_NAME,
                'purchase-ticket',
                [types.uint(eventId)],
                buyer.address
            )
        ]);

        assertEquals(block.receipts.length, 1);
        assertEquals(block.receipts[0].result, '(ok true)');

        // Verify ticket data
        const ticketId = 1; // First ticket should have ID 1
        const ticketData = chain.callReadOnlyFn(
            CONTRACT_NAME,
            'get-ticket',
            [types.uint(ticketId)],
            buyer.address
        );

        const ticket = ticketData.result.expectSome().expectTuple();
        assertEquals(ticket['event-id'], types.uint(eventId));
        assertEquals(ticket['owner'], buyer.address);
        assertEquals(ticket['purchase-price'], types.uint(1500000));
        assertEquals(ticket['is-used'], types.bool(false));
        assertEquals(ticket['is-refunded'], types.bool(false));

        // Verify event data was updated
        const eventData = chain.callReadOnlyFn(
            CONTRACT_NAME,
            'get-event',
            [types.uint(eventId)],
            buyer.address
        );

        const event = eventData.result.expectSome().expectTuple();
        assertEquals(event['tickets-sold'], types.uint(1));
        assertEquals(event['revenue'], types.uint(1500000));

        // Verify buyer's tickets
        const buyerTickets = chain.callReadOnlyFn(
            CONTRACT_NAME,
            'get-user-tickets',
            [types.principal(buyer.address)],
            buyer.address
        );

        const buyerTicketsData = buyerTickets.result.expectSome().expectTuple();
        const ownedTickets = buyerTicketsData['owned-tickets'].expectList();
        assertEquals(ownedTickets.length, 1);
        assertEquals(ownedTickets[0], types.uint(1));

        // Check balances
        const assetMap = chain.getAssetsMaps();
        const finalOrganizerBalance = assetMap.assets[organizer.address]["STX"];
        const finalBuyerBalance = assetMap.assets[buyer.address]["STX"];

        // Organizer should have received the ticket price
        assertEquals(finalOrganizerBalance, initialOrganizerBalance + 1500000);
        // Buyer should have paid the ticket price
        assertEquals(finalBuyerBalance, initialBuyerBalance - 1500000);
    },
});

Clarinet.test({
    name: "Ensure that ticket purchase fails for invalid events",
    async fn(chain: Chain, accounts: Map<string, Account>)
    {
        const organizer = accounts.get('wallet_1')!;
        const buyer = accounts.get('wallet_2')!;

        // Try to purchase a ticket for a non-existent event
        let block = chain.mineBlock([
            Tx.contractCall(
                CONTRACT_NAME,
                'purchase-ticket',
                [types.uint(999)], // Non-existent event ID
                buyer.address
            )
        ]);

        assertEquals(block.receipts.length, 1);
        assertEquals(block.receipts[0].result, '(err u2)'); // ERR-EVENT-NOT-FOUND

        // Create an event with very limited tickets
        block = chain.mineBlock([
            Tx.contractCall(
                CONTRACT_NAME,
                'create-event',
                [
                    types.utf8('Limited Event'),
                    types.utf8('Only one ticket available'),
                    types.utf8('Small Venue'),
                    types.uint(chain.blockHeight + 1000),
                    types.uint(1), // Only one ticket available
                    types.uint(1500000),
                    types.uint(144),
                    types.utf8('Exclusive')
                ],
                organizer.address
            )
        ]);

        const eventId = 1;

        // First purchase should succeed
        block = chain.mineBlock([
            Tx.contractCall(
                CONTRACT_NAME,
                'purchase-ticket',
                [types.uint(eventId)],
                buyer.address
            )
        ]);

        assertEquals(block.receipts.length, 1);
        assertEquals(block.receipts[0].result, '(ok true)');

        // Second purchase should fail (sold out)
        block = chain.mineBlock([
            Tx.contractCall(
                CONTRACT_NAME,
                'purchase-ticket',
                [types.uint(eventId)],
                accounts.get('wallet_3')!.address
            )
        ]);

        assertEquals(block.receipts.length, 1);
        assertEquals(block.receipts[0].result, '(err u3)'); // ERR-SOLD-OUT
    },
});

Clarinet.test({
    name: "Ensure that ticket validation works correctly",
    async fn(chain: Chain, accounts: Map<string, Account>)
    {
        const organizer = accounts.get('wallet_1')!;
        const buyer = accounts.get('wallet_2')!;

        // Create event and purchase ticket
        let block = chain.mineBlock([
            createEventTx(organizer.address),
            Tx.contractCall(
                CONTRACT_NAME,
                'purchase-ticket',
                [types.uint(1)], // Event ID
                buyer.address
            )
        ]);

        const ticketId = 1;

        // Validate ticket by organizer
        block = chain.mineBlock([
            Tx.contractCall(
                CONTRACT_NAME,
                'validate-ticket',
                [types.uint(ticketId)],
                organizer.address
            )
        ]);

        assertEquals(block.receipts.length, 1);
        assertEquals(block.receipts[0].result, '(ok true)');

        // Verify ticket was marked as used
        const ticketData = chain.callReadOnlyFn(
            CONTRACT_NAME,
            'get-ticket',
            [types.uint(ticketId)],
            buyer.address
        );

        const ticket = ticketData.result.expectSome().expectTuple();
        assertEquals(ticket['is-used'], types.bool(true));

        // Try to validate the same ticket again
        block = chain.mineBlock([
            Tx.contractCall(
                CONTRACT_NAME,
                'validate-ticket',
                [types.uint(ticketId)],
                organizer.address
            )
        ]);

        assertEquals(block.receipts.length, 1);
        assertEquals(block.receipts[0].result, '(err u10)'); // ERR-TICKET-USED
    },
});

Clarinet.test({
    name: "Ensure that only event organizer can validate tickets",
    async fn(chain: Chain, accounts: Map<string, Account>)
    {
        const organizer = accounts.get('wallet_1')!;
        const buyer = accounts.get('wallet_2')!;
        const imposter = accounts.get('wallet_3')!;

        // Create event and purchase ticket
        let block = chain.mineBlock([
            createEventTx(organizer.address),
            Tx.contractCall(
                CONTRACT_NAME,
                'purchase-ticket',
                [types.uint(1)], // Event ID
                buyer.address
            )
        ]);

        const ticketId = 1;

        // Try to validate ticket by non-organizer
        block = chain.mineBlock([
            Tx.contractCall(
                CONTRACT_NAME,
                'validate-ticket',
                [types.uint(ticketId)],
                imposter.address
            )
        ]);

        assertEquals(block.receipts.length, 1);
        assertEquals(block.receipts[0].result, '(err u1)'); // ERR-NOT-AUTHORIZED

        // Even ticket owner shouldn't be able to validate
        block = chain.mineBlock([
            Tx.contractCall(
                CONTRACT_NAME,
                'validate-ticket',
                [types.uint(ticketId)],
                buyer.address
            )
        ]);

        assertEquals(block.receipts.length, 1);
        assertEquals(block.receipts[0].result, '(err u1)'); // ERR-NOT-AUTHORIZED
    },
});

Clarinet.test({
    name: "Ensure that ticket refund works within the refund window",
    async fn(chain: Chain, accounts: Map<string, Account>)
    {
        const organizer = accounts.get('wallet_1')!;
        const buyer = accounts.get('wallet_2')!;

        // Create event and purchase ticket
        let block = chain.mineBlock([
            createEventTx(organizer.address),
            Tx.contractCall(
                CONTRACT_NAME,
                'purchase-ticket',
                [types.uint(1)], // Event ID
                buyer.address
            )
        ]);

        const ticketId = 1;
        const initialOrganizerBalance = chain.getAssetsMaps().assets[organizer.address]["STX"];
        const initialBuyerBalance = chain.getAssetsMaps().assets[buyer.address]["STX"];

        // Request refund
        block = chain.mineBlock([
            Tx.contractCall(
                CONTRACT_NAME,
                'refund-ticket',
                [types.uint(ticketId)],
                buyer.address
            )
        ]);

        assertEquals(block.receipts.length, 1);
        assertEquals(block.receipts[0].result, '(ok true)');

        // Verify ticket was marked as refunded
        const ticketData = chain.callReadOnlyFn(
            CONTRACT_NAME,
            'get-ticket',
            [types.uint(ticketId)],
            buyer.address
        );

        const ticket = ticketData.result.expectSome().expectTuple();
        assertEquals(ticket['is-refunded'], types.bool(true));

        // Verify event revenue was updated
        const eventData = chain.callReadOnlyFn(
            CONTRACT_NAME,
            'get-event',
            [types.uint(1)], // Event ID
            buyer.address
        );

        const event = eventData.result.expectSome().expectTuple();
        assertEquals(event['revenue'], types.uint(0)); // Revenue should be back to 0

        // Check balances after refund
        const finalOrganizerBalance = chain.getAssetsMaps().assets[organizer.address]["STX"];
        const finalBuyerBalance = chain.getAssetsMaps().assets[buyer.address]["STX"];

        // Organizer should have returned the ticket price
        assertEquals(finalOrganizerBalance, initialOrganizerBalance - 1500000);
        // Buyer should have received the refund
        assertEquals(finalBuyerBalance, initialBuyerBalance + 1500000);

        // Try to refund again
        block = chain.mineBlock([
            Tx.contractCall(
                CONTRACT_NAME,
                'refund-ticket',
                [types.uint(ticketId)],
                buyer.address
            )
        ]);

        assertEquals(block.receipts.length, 1);
        assertEquals(block.receipts[0].result, '(err u10)'); // ERR-TICKET-USED (or refunded)
    },
});

Clarinet.test({
    name: "Ensure that ticket refund fails after the refund window",
    async fn(chain: Chain, accounts: Map<string, Account>)
    {
        const organizer = accounts.get('wallet_1')!;
        const buyer = accounts.get('wallet_2')!;

        // Create event with small refund window
        const smallWindow = 10; // 10 blocks

        let block = chain.mineBlock([
            Tx.contractCall(
                CONTRACT_NAME,
                'create-event',
                [
                    types.utf8('Short Refund Event'),
                    types.utf8('Testing refund window'),
                    types.utf8('Venue'),
                    types.uint(chain.blockHeight + 1000),
                    types.uint(100),
                    types.uint(1500000),
                    types.uint(smallWindow), // Small refund window
                    types.utf8('Test')
                ],
                organizer.address
            ),
            Tx.contractCall(
                CONTRACT_NAME,
                'purchase-ticket',
                [types.uint(1)], // Event ID
                buyer.address
            )
        ]);

        const ticketId = 1;

        // Mine enough blocks to expire the refund window
        for (let i = 0; i < smallWindow + 1; i++)
        {
            chain.mineBlock([]);
        }

        // Try to refund after window expired
        block = chain.mineBlock([
            Tx.contractCall(
                CONTRACT_NAME,
                'refund-ticket',
                [types.uint(ticketId)],
                buyer.address
            )
        ]);

        assertEquals(block.receipts.length, 1);
        assertEquals(block.receipts[0].result, '(err u11)'); // ERR-REFUND-WINDOW-CLOSED
    },
});

Clarinet.test({
    name: "Ensure that only ticket owner can request refund",
    async fn(chain: Chain, accounts: Map<string, Account>)
    {
        const organizer = accounts.get('wallet_1')!;
        const buyer = accounts.get('wallet_2')!;
        const imposter = accounts.get('wallet_3')!;

        // Create event and purchase ticket
        let block = chain.mineBlock([
            createEventTx(organizer.address),
            Tx.contractCall(
                CONTRACT_NAME,
                'purchase-ticket',
                [types.uint(1)], // Event ID
                buyer.address
            )
        ]);

        const ticketId = 1;

        // Try to refund ticket by non-owner
        block = chain.mineBlock([
            Tx.contractCall(
                CONTRACT_NAME,
                'refund-ticket',
                [types.uint(ticketId)],
                imposter.address
            )
        ]);

        assertEquals(block.receipts.length, 1);
        assertEquals(block.receipts[0].result, '(err u1)'); // ERR-NOT-AUTHORIZED

        // Even the organizer shouldn't be able to initiate refund
        block = chain.mineBlock([
            Tx.contractCall(
                CONTRACT_NAME,
                'refund-ticket',
                [types.uint(ticketId)],
                organizer.address
            )
        ]);

        assertEquals(block.receipts.length, 1);
        assertEquals(block.receipts[0].result, '(err u1)'); // ERR-NOT-AUTHORIZED
    },
});

Clarinet.test({
    name: "Ensure that used tickets cannot be refunded",
    async fn(chain: Chain, accounts: Map<string, Account>)
    {
        const organizer = accounts.get('wallet_1')!;
        const buyer = accounts.get('wallet_2')!;

        // Create event and purchase ticket
        let block = chain.mineBlock([
            createEventTx(organizer.address),
            Tx.contractCall(
                CONTRACT_NAME,
                'purchase-ticket',
                [types.uint(1)], // Event ID
                buyer.address
            )
        ]);

        const ticketId = 1;

        // Validate the ticket first
        block = chain.mineBlock([
            Tx.contractCall(
                CONTRACT_NAME,
                'validate-ticket',
                [types.uint(ticketId)],
                organizer.address
            )
        ]);

        assertEquals(block.receipts.length, 1);
        assertEquals(block.receipts[0].result, '(ok true)');

        // Try to refund used ticket
        block = chain.mineBlock([
            Tx.contractCall(
                CONTRACT_NAME,
                'refund-ticket',
                [types.uint(ticketId)],
                buyer.address
            )
        ]);

        assertEquals(block.receipts.length, 1);
        assertEquals(block.receipts[0].result, '(err u10)'); // ERR-TICKET-USED
    },
});

Clarinet.test({
    name: "Ensure that contract owner can update platform settings",
    async fn(chain: Chain, accounts: Map<string, Account>)
    {
        const deployer = accounts.get('deployer')!;
        const nonOwner = accounts.get('wallet_1')!;

        // Update platform fee
        let block = chain.mineBlock([
            Tx.contractCall(
                CONTRACT_NAME,
                'update-platform-fee',
                [types.uint(10)], // 10% fee
                deployer.address
            )
        ]);

        assertEquals(block.receipts.length, 1);
        assertEquals(block.receipts[0].result, '(ok true)');

        // Check fee calculation
        const feeCalc = chain.callReadOnlyFn(
            CONTRACT_NAME,
            'calculate-platform-fee',
            [types.uint(1000)],
            deployer.address
        );

        assertEquals(feeCalc.result, types.uint(100)); // 10% of 1000 = 100

        // Update minimum ticket price
        block = chain.mineBlock([
            Tx.contractCall(
                CONTRACT_NAME,
                'update-min-ticket-price',
                [types.uint(2000000)], // 2 STX minimum
                deployer.address
            )
        ]);

        assertEquals(block.receipts.length, 1);
        assertEquals(block.receipts[0].result, '(ok true)');

        // Try to update settings as non-owner
        block = chain.mineBlock([
            Tx.contractCall(
                CONTRACT_NAME,
                'update-platform-fee',
                [types.uint(15)],
                nonOwner.address
            )
        ]);

        assertEquals(block.receipts.length, 1);
        assertEquals(block.receipts[0].result, '(err u1)'); // ERR-NOT-AUTHORIZED
    },
});

Clarinet.test({
    name: "Ensure multiple tickets can be purchased and tracked correctly",
    async fn(chain: Chain, accounts: Map<string, Account>)
    {
        const organizer = accounts.get('wallet_1')!;
        const buyer1 = accounts.get('wallet_2')!;
        const buyer2 = accounts.get('wallet_3')!;

        // Create event
        let block = chain.mineBlock([
            createEventTx(organizer.address)
        ]);

        const eventId = 1;

        // Multiple users purchase tickets
        block = chain.mineBlock([
            Tx.contractCall(
                CONTRACT_NAME,
                'purchase-ticket',
                [types.uint(eventId)],
                buyer1.address
            ),
            Tx.contractCall(
                CONTRACT_NAME,
                'purchase-ticket',
                [types.uint(eventId)],
                buyer2.address
            ),
            Tx.contractCall(
                CONTRACT_NAME,
                'purchase-ticket',
                [types.uint(eventId)],
                buyer1.address // Buy a second ticket
            )
        ]);

        assertEquals(block.receipts.length, 3);
        assertEquals(block.receipts[0].result, '(ok true)');
        assertEquals(block.receipts[1].result, '(ok true)');
        assertEquals(block.receipts[2].result, '(ok true)');

        // Verify event data
        const eventData = chain.callReadOnlyFn(
            CONTRACT_NAME,
            'get-event',
            [types.uint(eventId)],
            organizer.address
        );

        const event = eventData.result.expectSome().expectTuple();
        assertEquals(event['tickets-sold'], types.uint(3));
        assertEquals(event['revenue'], types.uint(4500000)); // 3 tickets * 1.5 STX

        // Verify buyer1 has two tickets
        const buyer1Tickets = chain.callReadOnlyFn(
            CONTRACT_NAME,
            'get-user-tickets',
            [types.principal(buyer1.address)],
            buyer1.address
        );

        const buyer1TicketsData = buyer1Tickets.result.expectSome().expectTuple();
        const buyer1OwnedTickets = buyer1TicketsData['owned-tickets'].expectList();
        assertEquals(buyer1OwnedTickets.length, 2);

        // Verify buyer2 has one ticket
        const buyer2Tickets = chain.callReadOnlyFn(
            CONTRACT_NAME,
            'get-user-tickets',
            [types.principal(buyer2.address)],
            buyer2.address
        );

        const buyer2TicketsData = buyer2Tickets.result.expectSome().expectTuple();
        const buyer2OwnedTickets = buyer2TicketsData['owned-tickets'].expectList();
        assertEquals(buyer2OwnedTickets.length, 1);
    },
});

Clarinet.test({
    name: "Ensure multiple events can be managed by organizer",
    async fn(chain: Chain, accounts: Map<string, Account>)
    {
        const organizer = accounts.get('wallet_1')!;

        // Create multiple events
        let block = chain.mineBlock([
            Tx.contractCall(
                CONTRACT_NAME,
                'create-event',
                [
                    types.utf8('Concert A'),
                    types.utf8('First concert'),
                    types.utf8('Venue A'),
                    types.uint(chain.blockHeight + 1000),
                    types.uint(100),
                    types.uint(1500000),
                    types.uint(144),
                    types.utf8('Music')
                ],
                organizer.address
            ),
            Tx.contractCall(
                CONTRACT_NAME,
                'create-event',
                [
                    types.utf8('Conference B'),
                    types.utf8('Business conference'),
                    types.utf8('Venue B'),
                    types.uint(chain.blockHeight + 2000),
                    types.uint(200),
                    types.uint(2000000),
                    types.uint(144),
                    types.utf8('Business')
                ],
                organizer.address
            )
        ]);

        assertEquals(block.receipts.length, 2);
        assertEquals(block.receipts[0].result, '(ok true)');
        assertEquals(block.receipts[1].result, '(ok true)');

        // Verify organizer data
        const organizerData = chain.callReadOnlyFn(
            CONTRACT_NAME,
            'get-organizer-revenue',
            [types.principal(organizer.address)],
            organizer.address
        );

        const organizerInfo = organizerData.result.expectSome().expectTuple();
        assertEquals(organizerInfo['events-organized'], types.uint(2));

        // Verify both events exist and have correct data
        const event1Data = chain.callReadOnlyFn(
            CONTRACT_NAME,
            'get-event',
            [types.uint(1)],
            organizer.address
        );

        const event1 = event1Data.result.expectSome().expectTuple();
        assertEquals(event1['name'], types.utf8('Concert A'));

        const event2Data = chain.callReadOnlyFn(
            CONTRACT_NAME,
            'get-event',
            [types.uint(2)],
            organizer.address
        );

        const event2 = event2Data.result.expectSome().expectTuple();
        assertEquals(event2['name'], types.utf8('Conference B'));
    },
});